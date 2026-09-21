const { z } = require('zod');

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

// Schema for individual dishes
const dishSchema = z.object({
  id: z.string().optional(),
  categoryId: z.string().default(''),
  name: z.string().min(1).max(100),
  price: z.number().nonnegative(),
  description: z.string().max(400).optional().default(''),
  photoUrl: z.string().url().max(1500).nullable().optional().or(z.literal('')),
  outOfStock: z.boolean().optional().default(false),
  tags: z.array(z.string().max(25)).max(8).optional().default([])
});

// Validation middleware factory
function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const firstError = result.error.errors[0]?.message || 'Datos de entrada inválidos';
      return res.status(400).json({ error: firstError, details: result.error.format() });
    }
    req.validatedBody = result.data;
    next();
  };
}

module.exports = {
  registerSchema,
  loginSchema,
  dishSchema,
  validateBody
};
