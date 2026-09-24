const { z } = require('zod');
const { errorResponse } = require('../utils/response');

// Schema for registration payload
const registerSchema = z.object({
  email: z.string().email({ message: 'Email inválido' }).max(100),
  password: z.string().min(6, { message: 'La contraseña debe tener al menos 6 caracteres' }).max(100),
  name: z.string().max(80).optional(),
  restaurantName: z.string().max(80).optional(),
  bizName: z.string().max(80).optional()
});

// Schema for login payload
const loginSchema = z.object({
  email: z.string().email({ message: 'Email inválido' }).max(100),
  password: z.string().min(1, { message: 'Contraseña requerida' })
});

// Schema for individual dishes with smart menu attributes
const dishSchema = z.object({
  id: z.string().optional(),
  categoryId: z.string().default(''),
  name: z.string().min(1, { message: 'Nombre del platillo requerido' }).max(100),
  price: z.number().nonnegative({ message: 'El precio debe ser un número positivo' }),
  previous_price: z.number().nonnegative().optional().nullable(),
  previousPrice: z.number().nonnegative().optional().nullable(),
  description: z.string().max(400).optional().default(''),
  photoUrl: z.string().url({ message: 'URL de foto inválida' }).max(1500).nullable().optional().or(z.literal('')),
  outOfStock: z.boolean().optional().default(false),
  tags: z.array(z.string().max(25)).max(8).optional().default([]),
  is_chef_recommended: z.boolean().optional().default(false),
  isChefRecommended: z.boolean().optional().default(false),
  available_hours: z.array(z.string()).optional().default([]),
  availableHours: z.array(z.string()).optional().default([]),
  available_days: z.array(z.number().min(0).max(6)).optional().default([0, 1, 2, 3, 4, 5, 6]),
  availableDays: z.array(z.number().min(0).max(6)).optional().default([0, 1, 2, 3, 4, 5, 6]),
  translations: z.record(z.any()).optional().default({})
});

// Schema for orders
const orderItemSchema = z.object({
  dishId: z.string().min(1, { message: 'ID de platillo requerido' }),
  name: z.string().min(1),
  price: z.number().nonnegative(),
  quantity: z.number().int().positive({ message: 'La cantidad debe ser mayor a 0' }),
  options: z.record(z.any()).optional()
});

const orderSchema = z.object({
  restaurantId: z.string().min(1, { message: 'ID de restaurante requerido' }),
  tableNumber: z.union([z.string(), z.number()]).optional(),
  items: z.array(orderItemSchema).min(1, { message: 'El pedido debe incluir al menos un producto' }),
  total: z.number().nonnegative(),
  customerName: z.string().max(100).optional(),
  customerPhone: z.string().max(30).optional(),
  deliveryAddress: z.string().max(200).optional(),
  paymentMethod: z.string().max(50).optional(),
  notes: z.string().max(300).optional()
});

// Schema for webhooks
const webhookSchema = z.object({
  provider: z.string().min(1, { message: 'Proveedor requerido' }),
  event: z.string().min(1, { message: 'Tipo de evento requerido' }),
  payload: z.record(z.any()),
  signature: z.string().optional()
});

/**
 * Reusable Zod validation middleware generator.
 * @param {import('zod').ZodSchema} schema - Zod schema to validate against
 * @param {'body'|'query'|'params'} [source='body'] - Request target property to validate
 * @returns {import('express').RequestHandler}
 */
function validate(schema, source = 'body') {
  return (req, res, next) => {
    const target = req[source] || {};
    const result = schema.safeParse(target);

    if (!result.success) {
      const firstError = result.error.issues?.[0]?.message || result.error.errors?.[0]?.message || 'Datos de entrada inválidos';
      const details = typeof result.error.format === 'function' ? result.error.format() : (result.error.issues || result.error.errors);
      return errorResponse(res, firstError, 400, details, 'VALIDATION_ERROR');
    }

    // Attach validated data to request
    req[`validated${source.charAt(0).toUpperCase() + source.slice(1)}`] = result.data;
    if (source === 'body') {
      req.validatedBody = result.data;
    }
    next();
  };
}

/**
 * Middleware factory for validating req.body against a Zod schema.
 * @param {import('zod').ZodSchema} schema
 */
function validateBody(schema) {
  return validate(schema, 'body');
}

/**
 * Middleware factory for validating req.query against a Zod schema.
 * @param {import('zod').ZodSchema} schema
 */
function validateQuery(schema) {
  return validate(schema, 'query');
}

/**
 * Middleware factory for validating req.params against a Zod schema.
 * @param {import('zod').ZodSchema} schema
 */
function validateParams(schema) {
  return validate(schema, 'params');
}

/**
 * Validates request components (body, query, params) simultaneously.
 * @param {{ body?: z.ZodSchema, query?: z.ZodSchema, params?: z.ZodSchema }} schemas
 */
function validateRequest(schemas) {
  return (req, res, next) => {
    for (const source of ['body', 'query', 'params']) {
      if (schemas[source]) {
        const result = schemas[source].safeParse(req[source] || {});
        if (!result.success) {
          const firstError = result.error.issues?.[0]?.message || result.error.errors?.[0]?.message || `Datos de ${source} inválidos`;
          const details = typeof result.error.format === 'function' ? result.error.format() : (result.error.issues || result.error.errors);
          return errorResponse(res, firstError, 400, details, 'VALIDATION_ERROR');
        }
        req[`validated${source.charAt(0).toUpperCase() + source.slice(1)}`] = result.data;
      }
    }
    next();
  };
}

module.exports = {
  registerSchema,
  loginSchema,
  dishSchema,
  orderSchema,
  webhookSchema,
  validate,
  validateBody,
  validateQuery,
  validateParams,
  validateRequest
};
