/**
 * api/services/emailTemplates.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Templates de correo con identidad de marca ScanGo.
 *
 * Módulo PURO: cero I/O, cero require de Resend, cero require de routes.
 * Cada función devuelve { subject, html, text, from } listo para pasar a
 * sendEmail({ to, subject, html, from }).
 *
 * Diseño ScanGo:
 *   - Oro principal:   #ECC94B
 *   - Oscuro de marca: #0E1412 / #151D1A
 *   - Superficie clara: #F8F8F6 (marfil)
 *   - Tinta:           #121212
 *   - Éxito:           #10B981 (verde esmeralda)
 *   - Advertencia:     #F59E0B (ámbar)
 *   - Peligro:         #EF4444 (rojo)
 *
 * Reglas del archivo (política P2):
 *   - Todo dato de usuario/tercero pasa por escapeHtmlText antes de entrar al HTML.
 *   - Todo href pasa por safeEmailHref (solo https:// o rutas absolutas /).
 *   - Los hrefs van escapados para atributos.
 *   - Siempre incluye pie legal CAN-SPAM (dirección postal, motivo, enlace de baja).
 */

const { buildEmailFooterHtml, signUnsubscribeToken } = require('../utils/emailFooter');

/** Escape HTML para interpolation en templates. */
function escapeHtmlText(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Href segura para los <a> de los emails (política del archivo, finding P2). */
function safeEmailHref(url) {
  const raw = String(url || '');
  if (!raw) return '';
  if (!/^(https?:\/\/|\/)/i.test(raw)) return '';
  return escapeHtmlText(raw);
}

/** Colores de marca */
const C = {
  gold: '#ECC94B',
  dark: '#0E1412',
  surface: '#F8F8F6',
  ink: '#121212',
  success: '#10B981',
  warn: '#F59E0B',
  danger: '#EF4444',
  muted: '#6E6E6E'
};

/** Dirección desde la que se envía cada tipo de correo. */
const FROM_BY_TYPE = {
  welcome:        'noreply@scango.uy',   // alta de cuenta, verificación
  verification:   'noreply@scango.uy',
  trial:          'noreply@scango.uy',   // prueba 7 días, vencimiento, gracia
  payment:        'facturacion@scango.uy', // recibos, pagos, renovaciones
  dunning:        'facturacion@scango.uy', // pago fallido, gracia, pausado
  reservation:    'reservas@scango.uy',  // alta, recordatorio, cambio de estado
  review:         'soporte@scango.uy',   // nudge de reseña (comensal)
  marketing:      'hola@scango.uy',      // promociones, winback, recuperación
  night:          'reportes@scango.uy',  // cierre nocturno (Z-report)
  new_client:     'hola@scango.uy',      // aviso al dueño de alta nueva
  system:         'noreply@scango.uy'    // sistema, sin respuesta esperada
};

/** Dirección de contacto física (CAN-SPAM §5). */
const POSTAL_ADDRESS = 'Rambla República del Perú 815, Montevideo, Uruguay';

/** Pie legal CAN-SPAM para emails transaccionales y comerciales. */
function legalFooter({ unsubscribeToken } = {}) {
  const unsubscribeHtml = unsubscribeToken
    ? `<p style="font-size:11px;color:${C.muted};margin-top:16px;">`
      + `¿No querés recibir más avisos? `
      + `<a href="${safeEmailHref(`/api/email/unsubscribe/${unsubscribeToken}`)}" style="color:${C.muted};text-decoration:underline;">Darme de baja</a>.`
      + `</p>`
    : '';
  return `
    <hr style="border:none;border-top:1px solid rgba(255,255,255,0.12);margin:24px 0;">
    <p style="font-size:11px;color:${C.muted};line-height:1.5;">
      ScanGo · Menú Digital QR · ${escapeHtmlText(POSTAL_ADDRESS)}<br>
      Este correo se envió porque tenés un local activo en ScanGo o solicitaste información.<br>
      ${unsubscribeHtml}
    </p>
  `;
}

/** Overlay de marca: header + contenedor tarjeta + cierre. */
function brandWrap({ title, preheader, bodyHtml, accentColor = C.gold, showLogo = true }) {
  const logo = showLogo
    ? `<div style="font-family:'Playfair Display',Georgia,serif;font-size:24px;font-weight:700;letter-spacing:-0.5px;color:${C.dark};margin-bottom:4px;">`
      + `<span style="color:${C.gold};">Scan</span>Go`
      + `</div>`
    : '';
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${escapeHtmlText(title)}</title>
    </head>
    <body style="margin:0;padding:0;background:${C.surface};font-family:'Plus Jakarta Sans','Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${C.ink};">
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
        <tr>
          <td align="center" style="padding:32px 16px;">
            <table width="100%" style="max-width:640px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid rgba(0,0,0,0.06);" role="presentation">
              <!-- Header de marca -->
              <tr>
                <td style="padding:32px 32px 16px 32px;background:#ffffff;text-align:left;">
                  ${logo}
                  <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:${C.muted};font-weight:700;margin-top:2px;">Menú Digital · QR · Pedidos por WhatsApp</div>
                </td>
              </tr>
              <!-- Cuerpo -->
              <tr>
                <td style="padding:24px 32px;color:${C.ink};font-size:15px;line-height:1.6;">
                  ${bodyHtml}
                </td>
              </tr>
              <!-- Pie -->
              <tr>
                <td style="padding:24px 32px;background:${C.surface};border-top:1px solid rgba(0,0,0,0.04);font-size:12px;color:${C.muted};line-height:1.5;">
                  <div style="font-weight:700;color:${C.dark};font-size:13px;margin-bottom:6px;">ScanGo — Menú Digital QR</div>
                  <div style="font-size:12px;color:${C.muted};">${escapeHtmlText(POSTAL_ADDRESS)}</div>
                  <div style="font-size:11px;color:${C.muted};margin-top:10px;">Este correo se envió porque tenés un local activo en ScanGo.</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;
}

/** Botón CTA de marca. */
function ctaButton({ label, href, accentColor = C.gold, textColor = '#101614' }) {
  const safeHref = safeEmailHref(href);
  return `
    <div style="text-align:center;margin:26px 0;">
      <a href="${safeHref}" style="display:inline-block;background:${accentColor};color:${textColor};font-weight:700;font-size:14px;padding:14px 28px;border-radius:8px;text-decoration:none;letter-spacing:0.4px;">${escapeHtmlText(label)}</a>
    </div>
  `;
}

/** Caja de datos (tabla limpia). */
function dataBox({ rows, accentColor = C.gold }) {
  const rowsHtml = rows.map(([k, v]) =>
    `<tr>`
    + `<td style="padding:10px 14px;font-size:13px;color:${C.muted};border-bottom:1px solid rgba(0,0,0,0.04);">${escapeHtmlText(k)}</td>`
    + `<td style="padding:10px 14px;font-size:13px;font-weight:700;color:${C.ink};border-bottom:1px solid rgba(0,0,0,0.04);text-align:right;">${escapeHtmlText(v)}</td>`
    + `</tr>`
  ).join('');
  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:18px 0;border:1px solid rgba(0,0,0,0.06);border-radius:10px;background:#ffffff;" role="presentation">
      ${rowsHtml}
    </table>
  `;
}

/** Platos top (para cierre nocturno). */
function topDishesList({ dishes }) {
  if (!Array.isArray(dishes) || dishes.length === 0) return '';
  const items = dishes.map((d, i) =>
    `<li style="margin:6px 0;font-size:13px;color:${C.ink};">`
    + `<span style="font-weight:700;color:${C.dark};">${escapeHtmlText(d.name || `Plato #${i+1}`)}</span>`
    + ` — <span style="color:${C.muted};">${Number(d.qty || 0)} pedidos</span>`
    + `</li>`
  ).join('');
  return `<div style="margin:16px 0;"><div style="font-weight:700;color:${C.dark};font-size:13px;margin-bottom:8px;">Top platos del día</div><ol style="margin:0;padding-left:18px;color:${C.ink};">${items}</ol></div>`;
}

/** ────────────────────────────────────────────────────────────────────────
 * TEMPLATES INDIVIDUALES
 * ────────────────────────────────────────────────────────────────────────

 */

function welcome({ to, restaurantName, menuUrl, studioUrl, unsubscribeToken }) {
  const place = escapeHtmlText(restaurantName || 'Tu restaurante');
  const link = safeEmailHref(studioUrl) || safeEmailHref('https://scango.uy/studio');
  const menu = safeEmailHref(menuUrl);
  const subject = `¡Bienvenido a ScanGo, ${place}!`;
  const body = `
    <h2 style="margin-top:0;color:${C.dark};font-size:20px;">¡Tu menú digital ya está listo!</h2>
    <p>Hola. Tu restaurante <strong>${place}</strong> tiene 7 días de prueba gratis para cargar platos, ajustar precios y personalizar la estética: sin tarjeta y sin compromiso.</p>
    ${ctaButton({ label: 'Empezar en el Panel Studio', href: link, accentColor: C.success })}
    ${menu ? `<p>Tu menú público (ya compartible): <a href="${menu}" style="color:${C.gold};">${escapeHtmlText(menu)}</a></p>` : ''}
    <p style="font-size:12px;color:${C.muted};">Te avisaremos por correo cuando tu prueba esté por terminar.</p>
  `;
  return {
    subject,
    html: brandWrap({ title: subject, bodyHtml: body, accentColor: C.success }),
    text: `¡Bienvenido a ScanGo, ${place}! Tu menú digital ya está listo. Iniciá sesión en ${studioUrl || 'https://scango.uy/studio'}.`,
    from: FROM_BY_TYPE.welcome
  };
}

function verification({ to, verificationLink, unsubscribeToken }) {
  const link = safeEmailHref(verificationLink);
  const subject = 'Confirmá tu dirección de correo electrónico';
  const body = `
    <h2 style="margin-top:0;color:${C.dark};">Verificá tu correo</h2>
    <p>Hacé clic en el botón para confirmar tu casilla y habilitar la publicación de tu menú:</p>
    ${ctaButton({ label: 'Confirmar mi Correo', href: link, accentColor: C.dark })}
  `;
  return {
    subject,
    html: brandWrap({ title: subject, bodyHtml: body, accentColor: C.dark }),
    text: `Verificá tu correo: ${verificationLink}`,
    from: FROM_BY_TYPE.verification
  };
}

function trialWarning({ to, userName, restaurantName, daysLeft, studioUrl, unsubscribeToken }) {
  const days = Number(daysLeft) || 0;
  const isLastDay = days <= 1;
  const restaurant = escapeHtmlText(restaurantName || 'Tu restaurante');
  const name = escapeHtmlText(userName || 'Responsable');
  const link = safeEmailHref(studioUrl) || safeEmailHref('https://scango.uy/studio');
  const subject = isLastDay ? '🚨 Último día de prueba gratuita' : `⚠️ Tu prueba gratuita expira en ${days} días`;
  const accent = isLastDay ? C.danger : C.warn;
  const body = `
    <h2 style="margin-top:0;color:${accent};">${isLastDay ? '¡Último día de prueba gratuita!' : 'Tu prueba gratuita está por terminar'}</h2>
    <p>Hola <strong>${name}</strong>,</p>
    <p>Tu restaurante <strong>${restaurant}</strong> tiene <strong>${isLastDay ? '1 día' : days + ' días'}</strong> restante${days > 1 ? 's' : ''} de prueba gratuita.</p>
    <p>Para mantener tu menú digital activo, actualizá tu plan:</p>
    ${ctaButton({ label: 'Activar Plan', href: link, accentColor: accent })}
    <p style="font-size:12px;color:${C.muted};">Si no actualizás, tu menú sigue online 3 días más y después queda pausado.</p>
  `;
  return {
    subject,
    html: brandWrap({ title: subject, bodyHtml: body, accentColor: accent }),
    text: `Tu prueba gratuita expira en ${days} día${days > 1 ? 's' : ''}. Activá tu plan en ${studioUrl}`,
    from: FROM_BY_TYPE.trial
  };
}

function trialExpired({ to, userName, restaurantName, graceDays, studioUrl, menuUrl, unsubscribeToken }) {
  const grace = Number(graceDays) || 3;
  const restaurant = escapeHtmlText(restaurantName || 'Tu restaurante');
  const name = escapeHtmlText(userName || 'Responsable');
  const link = safeEmailHref(studioUrl) || safeEmailHref('https://scango.uy/studio');
  const menu = safeEmailHref(menuUrl);
  const subject = `Tu prueba gratuita de ScanGo terminó — ${restaurant}`;
  const body = `
    <h2 style="margin-top:0;color:${C.danger};">Terminó tu prueba gratuita</h2>
    <p>Hola <strong>${name}</strong>,</p>
    <p>Los 7 días gratis de <strong>${restaurant}</strong> en ScanGo llegaron a su fin.</p>
    <p>Buena noticia: tu menú sigue <strong>online</strong> durante <strong>${grace} días más</strong> para que no pierdas ni un cliente. Activá tu plan para mantenerlo publicado.</p>
    ${ctaButton({ label: 'Activar mi plan', href: link, accentColor: C.success })}
    ${menu ? `<p style="font-size:12px;">Tu menú: <a href="${menu}" style="color:${C.gold};">${escapeHtmlText(menu)}</a></p>` : ''}
    <p style="font-size:12px;color:${C.muted};">Pasados los ${grace} días de gracia, el menú queda pausado hasta que actives tu plan. Podés reactivarlo en cualquier momento.</p>
  `;
  return {
    subject,
    html: brandWrap({ title: subject, bodyHtml: body, accentColor: C.danger }),
    text: `Tu prueba gratuita terminó. Tu menú sigue online ${grace} días más. Activá tu plan en ${studioUrl}`,
    from: FROM_BY_TYPE.trial
  };
}

function menuPaused({ to, userName, restaurantName, studioUrl, unsubscribeToken }) {
  const restaurant = escapeHtmlText(restaurantName || 'Tu restaurante');
  const name = escapeHtmlText(userName || 'Responsable');
  const link = safeEmailHref(studioUrl) || safeEmailHref('https://scango.uy/studio');
  const subject = `⚠️ El menú de ${restaurant} quedó pausado`;
  const body = `
    <h2 style="margin-top:0;color:${C.danger};">Tu menú quedó pausado</h2>
    <p>Hola <strong>${name}</strong>,</p>
    <p>Se agotó el período de gracia de <strong>${restaurant}</strong> y tu menú digital dejó de estar disponible para tus clientes.</p>
    <p>Al activar tu plan se reactiva al instante: volvés a estar online con todos tus platos y precios tal como los dejaste.</p>
    ${ctaButton({ label: 'Reactivar mi menú', href: link, accentColor: C.success })}
    <p style="font-size:12px;color:${C.muted};">No se realizó ningún cobro: tu suscripción sólo se activa cuando pagás.</p>
  `;
  return {
    subject,
    html: brandWrap({ title: subject, bodyHtml: body, accentColor: C.danger }),
    text: `Tu menú quedó pausado. Reactivá tu plan en ${studioUrl}`,
    from: FROM_BY_TYPE.dunning
  };
}

function paymentReceipt({ to, userName, restaurantName, planName, renewsAt, unsubscribeToken }) {
  const restaurant = escapeHtmlText(restaurantName || 'Tu restaurante');
  const name = escapeHtmlText(userName || 'Responsable');
  const plan = escapeHtmlText(planName || 'Pro Mensual');
  const renewDate = renewsAt ? new Date(renewsAt) : null;
  const renewLabel = renewDate && !isNaN(renewDate.getTime()) ? escapeHtmlText(renewDate.toLocaleDateString('es-UY')) : '—';
  const subject = `✓ Confirmación de pago — Plan ${plan}`;
  const body = `
    <h2 style="margin-top:0;color:${C.success};">¡Pago confirmado!</h2>
    <p>Hola <strong>${name}</strong>,</p>
    <p>Tu suscripción al plan <strong>${plan}</strong> está activa.</p>
    ${dataBox({
      rows: [
        ['Restaurante', restaurant],
        ['Plan', plan],
        ['Próximo cobro', renewLabel]
      ]
    })}
    <p style="font-size:12px;color:${C.muted};">Gracias por confiar en ScanGo.</p>
  `;
  return {
    subject,
    html: brandWrap({ title: subject, bodyHtml: body, accentColor: C.success }),
    text: `Pago confirmado — Plan ${plan}. Restaurante: ${restaurant}. Próximo cobro: ${renewLabel}`,
    from: FROM_BY_TYPE.payment
  };
}

function paymentFailed({ to, userName, restaurantName, planName, gracePeriodDays, updatePaymentUrl, unsubscribeToken }) {
  const restaurant = escapeHtmlText(restaurantName || 'Tu restaurante');
  const name = escapeHtmlText(userName || 'Responsable');
  const plan = escapeHtmlText(planName || 'Pro Mensual');
  const grace = Number(gracePeriodDays) || 7;
  const link = safeEmailHref(updatePaymentUrl) || safeEmailHref('https://scango.uy/studio?tab=billing');
  const subject = `⚠️ No pudimos procesar tu pago — ${restaurant}`;
  const body = `
    <h2 style="margin-top:0;color:${C.warn};">No pudimos procesar tu pago</h2>
    <p>Hola <strong>${name}</strong>,</p>
    <p>El cargo de tu suscripción al plan <strong>${plan}</strong> del restaurante <strong>${restaurant}</strong> no pudo ser procesado.</p>
    <p>Tenés <strong>${grace} días</strong> para actualizar tu método de pago antes de que tu menú sea pausado.</p>
    ${ctaButton({ label: 'Actualizar Método de Pago', href: link, accentColor: C.warn })}
    <p style="font-size:12px;color:${C.muted};">Si ya actualizaste tu tarjeta, ignorá este correo.</p>
  `;
  return {
    subject,
    html: brandWrap({ title: subject, bodyHtml: body, accentColor: C.warn }),
    text: `No pudimos procesar tu pago. Tenés ${grace} días para actualizar tu método de pago.`,
    from: FROM_BY_TYPE.dunning
  };
}

function dunningReminder({ to, userName, restaurantName, planName, daysLeft, gracePeriodDays, updatePaymentUrl, unsubscribeToken }) {
  const days = Number(daysLeft) || 0;
  const grace = Number(gracePeriodDays) || 7;
  const restaurant = escapeHtmlText(restaurantName || 'Tu restaurante');
  const name = escapeHtmlText(userName || 'Responsable');
  const plan = escapeHtmlText(planName || 'Pro Mensual');
  const link = safeEmailHref(updatePaymentUrl) || safeEmailHref('https://scango.uy/studio?tab=billing');
  const accent = days <= 2 ? C.danger : C.warn;
  const plural = days === 1 ? '' : 's';
  const subject = `Recordatorio: Tu suscripción de ${restaurant} será pausada en ${days} día${plural}`;
  const body = `
    <h2 style="margin-top:0;color:${accent};">Tu suscripción será pausada en ${days} día${plural}</h2>
    <p>Hola <strong>${name}</strong>,</p>
    <p>El restaurante <strong>${restaurant}</strong> tiene un pago pendiente del plan <strong>${plan}</strong>.</p>
    <p>Quedan <strong>${days} día${plural}</strong> de gracia (de ${grace} en total) antes de que tu menú sea pausado.</p>
    ${ctaButton({ label: 'Regularizar Ahora', href: link, accentColor: accent })}
    <p style="font-size:12px;color:${C.muted};">Si ya regularizaste el pago, ignorá este correo.</p>
  `;
  return {
    subject,
    html: brandWrap({ title: subject, bodyHtml: body, accentColor: accent }),
    text: `Tu suscripción será pausada en ${days} día${plural}. Regularizá tu pago en ${updatePaymentUrl}`,
    from: FROM_BY_TYPE.dunning
  };
}

function newClientNotification({ to, source, clientEmail, clientName, restaurantName, slug, planName, menuUrl }) {
  const srcLabel = source === 'subscription' ? 'Nueva suscripción' : source === 'google' ? 'Nuevo registro (Google)' : 'Nuevo registro';
  const place = escapeHtmlText(restaurantName || '-');
  const who = escapeHtmlText(clientName || '-');
  const whoEmail = escapeHtmlText(clientEmail || '-');
  const what = escapeHtmlText(source || 'register');
  const subject = `[ScanGo] ${srcLabel}: ${restaurantName || clientEmail || 'cliente'}`;
  const body = `
    <h2 style="margin-top:0;color:${C.dark};">${escapeHtmlText(srcLabel)}</h2>
    ${dataBox({
      rows: [
        ['Cliente', who],
        ['Email', whoEmail],
        ['Restaurante', place],
        ...(slug ? [['Slug', slug]] : []),
        ...(planName ? [['Plan', planName]] : []),
        ...(menuUrl ? [['Menú', `<a href="${safeEmailHref(menuUrl)}" style="color:${C.gold};">${escapeHtmlText(menuUrl)}</a>`]] : [])
      ]
    })}
    <p style="font-size:12px;color:${C.muted};">Fuente: ${escapeHtmlText(what)} · ${new Date().toISOString()}</p>
  `;
  const recipients = to
    ? (Array.isArray(to) ? to : String(to).split(',').map(x => x.trim()).filter(Boolean))
    : String(process.env.OWNER_NOTIFICATION_EMAIL || process.env.ADMIN_NOTIFICATION_EMAIL || process.env.NOTIFICATION_EMAIL || '')
        .split(',')
        .map(x => x.trim())
        .filter(Boolean);
  return {
    subject,
    html: brandWrap({ title: subject, bodyHtml: body, accentColor: C.success }),
    text: `${srcLabel}: ${who} (${whoEmail}) — ${place}`,
    from: FROM_BY_TYPE.new_client,
    to: recipients
  };
}

function nightSummary({ to, restaurantName, localDay, currency, summary, studioUrl, unsubscribeToken }) {
  if (!summary || !localDay) throw new Error('localDay y summary son requeridos');
  const place = escapeHtmlText(restaurantName || 'Tu local');
  const day = escapeHtmlText(localDay);
  const link = safeEmailHref(studioUrl) || safeEmailHref('https://scango.uy/studio?tab=notifications');
  const S = summary;
  const counts = S.counts || {};
  const ccy = escapeHtmlText(String(currency || S.currency || 'USD'));
  const fmt = (n) => {
    const num = Number(n) || 0;
    try { return new Intl.NumberFormat('es-UY', { style: 'currency', currency: String(currency || S.currency || 'USD'), maximumFractionDigits: 2 }).format(num); }
    catch { return `${ccy} ${num.toFixed(2)}`; }
  };
  const total = Number(counts.total) || 0;
  const delivered = Number(counts.delivered) || 0;
  const cancelled = Number(counts.cancelled) || 0;
  const capNote = counts.truncated ? ' <span style="color:#b45309;">(500+: resumen parcial)</span>' : '';
  const topRows = (Array.isArray(S.topDishes) ? S.topDishes : []).map((dish, i) =>
    `<li style="margin:4px 0;font-size:13px;color:${C.ink};"><span style="font-weight:700;color:${C.dark};">${escapeHtmlText(dish.name || `Plato #${i+1}`)}</span> — <span style="color:${C.muted};">${Number(dish.qty || 0)} pedidos</span></li>`
  ).join('');
  const row = (k, v) => `<tr><td style="padding:8px 12px;font-size:13px;color:${C.muted};border-bottom:1px solid rgba(0,0,0,0.04);">${escapeHtmlText(k)}</td><td style="padding:8px 12px;font-size:13px;font-weight:700;color:${C.ink};text-align:right;border-bottom:1px solid rgba(0,0,0,0.04);">${escapeHtmlText(v)}</td></tr>`;
  const subject = `Tu cierre de hoy: ${total} pedidos · ${fmt(S.revenue)}`;
  const body = `
    <h2 style="margin-top:0;color:${C.success};">Tu cierre — ${day}</h2>
    <p style="margin-top:-8px;color:${C.muted};font-size:14px;">${place} · la jornada que acabó, en una línea.</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:14px 0;border:1px solid rgba(0,0,0,0.06);border-radius:10px;" role="presentation">
      ${row('Pedidos', `${total}${capNote}`)}
      ${row('Entregados', delivered)}
      ${row('Cancelados', cancelled)}
      ${row('Ingresos', fmt(S.revenue))}
      ${row('Propinas', fmt(S.tips))}
      ${row('Ticket promedio', fmt(S.avgTicket))}
      ${S.peakHour && S.peakHour.label ? row('Hora pico', escapeHtmlText(String(S.peakHour.label))) : ''}
      ${S.firstOrderLabel || S.lastOrderLabel ? row('Ventana', `${escapeHtmlText(String(S.firstOrderLabel || ''))} → ${escapeHtmlText(String(S.lastOrderLabel || ''))}`) : ''}
    </table>
    ${total > 0 && topRows ? `<div style="margin:16px 0;"><div style="font-weight:700;color:${C.dark};font-size:13px;margin-bottom:8px;">Top platos del día</div><ol style="margin:0;padding-left:18px;color:${C.ink};">${topRows}</ol></div>` : ''}
    ${ctaButton({ label: 'Ver Pedidos en vivo', href: link, accentColor: C.success })}
    <p style="font-size:12px;color:${C.muted};">Ingresos sin propinas (mismo criterio que tu panel: la propina no distorsiona el ticket). Se envía cada noche con cierre a la madrugada; se puede desactivar desde tu Studio.</p>
  `;
  return {
    subject,
    html: brandWrap({ title: subject, bodyHtml: body, accentColor: C.success }),
    text: `Cierre de ${day}: ${total} pedidos, ingresos ${fmt(S.revenue)}.`,
    from: FROM_BY_TYPE.night
  };
}

function reservationRequest({ to, restaurantName, reservation }) {
  const place = escapeHtmlText(restaurantName || 'tu local');
  const who = escapeHtmlText(reservation.name || 'Comensal');
  const day = escapeHtmlText(reservation.date || '');
  const hour = escapeHtmlText(reservation.time || '');
  const pax = reservation.paxLabel ? escapeHtmlText(reservation.paxLabel) : String(reservation.pax || '');
  const notes = reservation.notes ? escapeHtmlText(reservation.notes) : '';
  const phone = escapeHtmlText(reservation.phone || '');
  const emailRow = reservation.email ? `<tr><td style="padding:8px 12px;font-size:13px;color:${C.muted};">Email</td><td style="padding:8px 12px;font-size:13px;color:${C.ink};">${escapeHtmlText(reservation.email)}</td></tr>` : '';
  const subject = `📅 Nueva reserva en ${place}`;
  const body = `
    <h2 style="margin-top:0;color:${C.dark};">📅 Nueva reserva en ${place}</h2>
    <p><strong>${who}</strong> pidió una mesa para <strong>${pax}</strong>:</p>
    ${dataBox({
      rows: [
        ['Fecha', day],
        ['Hora', hour],
        ['Teléfono', phone],
        ...(notes ? [['Nota', notes]] : []),
        ...(reservation.email ? [['Email', reservation.email]] : [])
      ]
    })}
    <p style="font-size:13px;color:${C.muted};">Confirmala (o cancelala) desde el Studio → tab Reservas. El comensal recibe un recordatorio 24 h antes si está confirmada.</p>
  `;
  return {
    subject,
    html: brandWrap({ title: subject, bodyHtml: body, accentColor: C.dark }),
    text: `Nueva reserva en ${place}: ${who} para ${pax} el ${day} a las ${hour}. Tel: ${phone}`,
    from: FROM_BY_TYPE.reservation
  };
}

function reservationReminder({ to, customerName, restaurantName, date, time, menuUrl }) {
  const place = escapeHtmlText(restaurantName || 'tu local favorito');
  const who = customerName ? `${escapeHtmlText(customerName)}, ` : '';
  const day = escapeHtmlText(date);
  const hour = escapeHtmlText(time);
  const menu = safeEmailHref(menuUrl);
  const subject = `⏰ Tu reserva en ${place} es mañana`;
  const body = `
    <h2 style="margin-top:0;color:${C.dark};">⏰ Tu reserva en ${place} es mañana</h2>
    <p>Hola ${who}te recordamos tu mesa:</p>
    ${dataBox({
      rows: [
        ['Fecha', day],
        ['Hora', hour]
      ]
    })}
    <p>Si no podés venir, avisale al local con tiempo así libera la mesa.</p>
    ${menu ? `<p style="font-size:13px;"><a href="${menu}" style="color:${C.gold};">Ver la carta</a></p>` : ''}
  `;
  return {
    subject,
    html: brandWrap({ title: subject, bodyHtml: body, accentColor: C.dark }),
    text: `Tu reserva en ${place} es mañana ${day} a las ${hour}.`,
    from: FROM_BY_TYPE.reservation
  };
}

function reservationStatus({ to, restaurantName, reservation, status }) {
  const place = escapeHtmlText(restaurantName || 'tu local favorito');
  const who = reservation.name ? `${escapeHtmlText(reservation.name)}, ` : '';
  const day = escapeHtmlText(reservation.date || '');
  const hour = escapeHtmlText(reservation.time || '');
  const pax = reservation.paxLabel ? escapeHtmlText(reservation.paxLabel) : String(reservation.pax || '');
  const reason = reservation.cancelReason ? escapeHtmlText(reservation.cancelReason) : '';
  const whenBox = day && hour
    ? `${dataBox({ rows: [['Fecha', day], ['Hora', hour], ['Comensales', pax]] })}`
    : '';
  let title, body, subject;
  if (status === 'confirmed') {
    title = '✅ Tu reserva quedó confirmada';
    body = `<p>Hola ${who}tu mesa en ${place} quedó confirmada. ¡Te esperamos!</p>`;
    subject = `✅ Reserva confirmada — ${place}`;
  } else if (status === 'cancelled') {
    title = '🚫 Tu reserva fue cancelada';
    body = `<p>Hola ${who}tu reserva en ${place} fue cancelada por el local.</p>` + (reason ? `<p style="font-size:13px;color:${C.muted};">Motivo: ${reason}</p>` : '') + '<p>Si fue un malentendido, volvé a reservar desde la carta o respondé este email.</p>';
    subject = `🚫 Reserva cancelada — ${place}`;
  } else if (status === 'no_show') {
    title = `😔 No te vimos en ${place}`;
    body = `<p>Hola ${who}marcamos tu reserva del <strong>${day}</strong> ${hour} como no-asistida.</p><p>Si llegaste y no te encontramos, avisale al local — y si no pudiste ir, ¡sin drama! Esperamos verte pronto.</p>`;
    subject = `No te vimos en ${place}`;
  } else {
    return null; // skip honesto
  }
  return {
    subject,
    html: brandWrap({ title, bodyHtml: `<h2 style="margin-top:0;color:${C.dark};">${title}</h2>${body}${whenBox}`, accentColor: C.success }),
    text: `${title}. ${day} a las ${hour}.`,
    from: FROM_BY_TYPE.reservation
  };
}

function reviewRequest({ to, customerName, restaurantName, reviewUrl, unsubscribeToken }) {
  const place = escapeHtmlText(restaurantName || 'tu local favorito');
  const who = customerName ? `${escapeHtmlText(customerName)}, ` : '';
  const review = safeEmailHref(reviewUrl);
  const subject = `¿Cómo estuvo tu experiencia en ${place}?`;
  const body = `
    <h2 style="margin-top:0;color:${C.dark};">¿Cómo estuvo tu experiencia en ${place}?</h2>
    <p>Hola ${who}pediste en ${place} y queremos saber cómo te fue.</p>
    <p>Si salió rico, contanos; si algo falló, contanos también. Tu opinión llega directo al dueño.</p>
    ${ctaButton({ label: 'Contar mi experiencia', href: review, accentColor: C.success })}
    <p style="font-size:12px;color:${C.muted};">Tu opinión ayuda a ${place} a mejorar cada semana.</p>
  `;
  return {
    subject,
    html: brandWrap({ title: subject, bodyHtml: body, accentColor: C.success }),
    text: `¿Cómo estuvo tu experiencia en ${place}? Contá tu opinión en ${reviewUrl}`,
    from: FROM_BY_TYPE.review
  };
}

function winbackCoupon({ to, restaurantName, message, couponCode, couponLabel, expiresAt, menuUrl, unsubscribeToken }) {
  const place = escapeHtmlText(restaurantName || 'Tu restaurante');
  const msg = escapeHtmlText(message || '').trim();
  const code = escapeHtmlText(couponCode || '');
  const label = escapeHtmlText(couponLabel || '');
  const expires = escapeHtmlText(expiresAt || '');
  const link = typeof menuUrl === 'string' && menuUrl.startsWith('http') ? menuUrl : '';
  const subject = `Volvé a ${place} — te guardamos un cupón`;
  const body = `
    <h2 style="margin-top:0;color:${C.dark};">Te extrañamos — tenés un cupón de ${place}</h2>
    ${msg ? `<p>${msg.replace(/\n/g, '<br>')}</p>` : ''}
    ${code ? `<div style="text-align:center;padding:20px;border:2px dashed ${C.success};border-radius:12px;margin:18px 0;background:#f0fdf4;">
      <div style="font-size:12px;color:${C.muted};font-weight:700;text-transform:uppercase;letter-spacing:1px;">${label || 'Cupón de bienvenida de vuelta'}</div>
      <div style="font-size:26px;font-weight:800;letter-spacing:2px;color:${C.dark};">${code}</div>
      ${expires ? `<div style="font-size:12px;color:${C.muted};margin-top:6px;">Válido hasta ${expires}</div>` : ''}
    </div>` : ''}
    ${link ? `<p><a href="${safeEmailHref(link)}" style="background:${C.success};color:#fff;padding:12px 24px;text-decoration:none;font-weight:700;border-radius:8px;display:inline-block;">Ver carta y pedir</a></p>` : ''}
    <p style="font-size:12px;color:${C.muted};">Un solo uso. Si no querés recibir más avisos, podés darte de baja abajo.</p>
  `;
  return {
    subject,
    html: brandWrap({ title: subject, bodyHtml: body, accentColor: C.success }),
    text: `Volvé a ${place}. Tu cupón: ${code}.`,
    from: FROM_BY_TYPE.marketing
  };
}

function promotional({ to, subject, body, restaurantName, promoCode, promoLink, unsubscribeToken }) {
  const place = escapeHtmlText(restaurantName || 'Tu Restaurante Favorito');
  const promoBody = escapeHtmlText(body || '').replace(/\n/g, '<br>');
  const code = escapeHtmlText(promoCode || '');
  const link = safeEmailHref(promoLink);
  const subjectLine = subject || `Especiales de ${place}`;
  const bodyHtml = `
    <h2 style="margin-top:0;color:${C.dark};">${subjectLine}</h2>
    ${promoBody ? `<p>${promoBody}</p>` : ''}
    ${code ? `<div style="text-align:center;padding:20px;border:2px dashed ${C.success};border-radius:12px;margin:18px 0;background:#f0fdf4;">
      <div style="font-size:12px;color:${C.muted};font-weight:700;text-transform:uppercase;letter-spacing:1px;">Cupón de descuento</div>
      <div style="font-size:26px;font-weight:800;letter-spacing:2px;color:${C.dark};">${code}</div>
    </div>` : ''}
    ${link ? `<p><a href="${safeEmailHref(link)}" style="background:${C.gold};color:#101614;padding:12px 24px;text-decoration:none;font-weight:700;border-radius:8px;display:inline-block;">Ver Menú y Pedir</a></p>` : ''}
  `;
  return {
    subject: subjectLine,
    html: brandWrap({ title: subjectLine, bodyHtml: bodyHtml, accentColor: C.gold }),
    text: `${subjectLine}\n${body || ''}`,
    from: FROM_BY_TYPE.marketing
  };
}

module.exports = {
  C,
  FROM_BY_TYPE,
  brandWrap,
  ctaButton,
  dataBox,
  topDishesList,
  legalFooter,
  welcome,
  verification,
  trialWarning,
  trialExpired,
  menuPaused,
  paymentReceipt,
  paymentFailed,
  dunningReminder,
  newClientNotification,
  nightSummary,
  reservationRequest,
  reservationReminder,
  reservationStatus,
  reviewRequest,
  winbackCoupon,
  promotional
};
