/**
 * public/js/menu/orderSubmit.js
 * ─────────────────────────────
 * Envío del pedido (extraído de menu.js sin cambios de comportamiento: misma
 * lógica, mismas strings, mismo orden). Cotiza contra /api/orders/quote,
 * arma el mensaje de WhatsApp, registra el pedido para tracking y abre wa.me.
 * Todo el estado de menu.js llega por `ctx`:
 * {
 *   getCart, getRestaurantData, isRestaurantOpenNow, getCustomerPhone,
 *   toOrderItemPayload, getCaptchaToken, getDeliveryFee: () => number,
 *   getAppliedCoupon: () => object|null, getTip: () => { percent, custom },
 *   saveOrderTracking, showOrderTrackingFab, getSlug, trackPublicEvent
 * }
 * Sin imports fuera de public/js. Sin DOM en import (seguro en Node).
 */
import { computeTipAmount } from './tipCalculator.js';


    async function submitWhatsAppOrder(ctx) {
      const items = Object.values(ctx.getCart());
      if (!items.length) {
        alert('Por favor agrega platos a tu pedido primero.');
        return;
      }

      // Local cerrado: no se genera el pedido (el badge ya lo avisa).
      if (!ctx.isRestaurantOpenNow()) {
        alert(ctx.getRestaurantData().forceClosed === true
          ? 'El local está cerrado por el momento. Volvé a consultar en unos minutos.'
          : `El local está cerrado ahora (${ctx.getRestaurantData().scheduleActiveHours} hs). Volvé en horario de atención.`);
        return;
      }

      const btn = document.getElementById('btnSubmitOrderWA');
      if (btn?.dataset.submitting === 'true') return;
      const originalHtml = btn?.innerHTML;
      let popup = null;
      if (btn) {
        btn.dataset.submitting = 'true';
        btn.disabled = true;
        btn.innerHTML = '<span>⏳ Verificando precios...</span>';
      }

      try {
        popup = window.open('about:blank', '_blank');
        const mode = document.getElementById('orderMode').value;
        const customerName = document.getElementById('orderCustomerName').value.trim() || 'Cliente';
        const notes = document.getElementById('orderNotes').value.trim();
        const payment = document.getElementById('orderPayment').value;
        const currency = ctx.getRestaurantData().currency || '$';
        const zoneSelect = document.getElementById('deliveryZoneSelect');
        const tableNumber = document.getElementById('orderTable').value.trim() || '1';
        const address = document.getElementById('orderAddress').value.trim();
        const isGroupOrder = Boolean(window.groupCartManagerInstance && window.groupCartManagerInstance.isGroupActive());
        const quoteResponse = await fetch('/api/orders/quote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            restaurantId: ctx.getRestaurantData().id,
            tableNumber,
            customerName,
            customerPhone: ctx.getCustomerPhone(),
            deliveryAddress: mode === 'DELIVERY' ? address : '',
            orderMode: mode,
            currency,
            notes,
            isGroupOrder,
            participants: window.groupCartManagerInstance ? Array.from(window.groupCartManagerInstance.participants) : [],
            // Huso del dispositivo: el servidor valida el horario de atención
            // y el abierto/cerrado en hora local del local (no confía del todo
            // en el reloj del navegador).
            utcOffsetMinutes: -new Date().getTimezoneOffset(),
            items: items.map(item => {
              const p = ctx.toOrderItemPayload(item);
              return {
                dishId: p.dishId,
                quantity: p.quantity,
                note: p.note,
                orderedBy: p.orderedBy,
                orderedById: p.orderedById,
                ...(p.customIceCream ? { customIceCream: p.customIceCream } : {}),
                choices: (item.choices || []).map(choice => ({
                  groupId: choice.groupId,
                  selections: choice.selections.map(selection => ({
                    optionId: selection.optionId,
                    quantity: selection.quantity
                  }))
                }))
              };
            })
          })
        });
        const quotePayload = await quoteResponse.json();
        if (!quoteResponse.ok || !quotePayload.success || !quotePayload.data) {
          throw new Error(quotePayload.error || 'No se pudo validar el pedido. Revisá las opciones y volvé a intentar.');
        }

        const quote = quotePayload.data;
        // Delivery inservible: zona + dirección se exigen ANTES de pedir
        // (el backend también lo valida; acá se guía con foco al campo).
        if (mode === 'DELIVERY') {
          const zoneValue = zoneSelect ? zoneSelect.value : '0';
          if (!zoneValue || zoneValue === '0') {
            if (zoneSelect) zoneSelect.focus();
            throw new Error('Elegí tu zona de entrega para calcular el envío.');
          }
          if (!address) {
            const addrInput = document.getElementById('orderAddress');
            if (addrInput) addrInput.focus();
            throw new Error('Escribí tu dirección de entrega para que el pedido llegue bien.');
          }
        }
        const subtotal = quote.amount;
        const currentDelivery = mode === 'DELIVERY' ? ctx.getDeliveryFee() : 0;
        const currentDiscount = ctx.getAppliedCoupon()?.type === 'percent'
          ? Math.round(subtotal * (ctx.getAppliedCoupon().value / 100) * 100) / 100
          : (ctx.getAppliedCoupon()?.type === 'free_delivery' && mode === 'DELIVERY' ? currentDelivery : 0);
        const total = Math.max(0, subtotal + currentDelivery - currentDiscount);
        // Propina opcional elegida por el comensal (base = subtotal de platos).
        const { percent: tipPercent, custom: tipCustom } = ctx.getTip();
        const tipAmount = computeTipAmount(subtotal, tipPercent, tipCustom);
        const grandTotal = total + tipAmount;

        let msg = isGroupOrder
          ? `👥 *PEDIDO GRUPAL COLABORATIVO - ${ctx.getRestaurantData().name.toUpperCase()}*\n`
          : `📋 *NUEVO PEDIDO - ${ctx.getRestaurantData().name.toUpperCase()}*\n`;
        msg += `👤 *Cliente:* ${customerName}\n`;
        const customerPhoneForMsg = ctx.getCustomerPhone();
        if (customerPhoneForMsg) msg += `📱 *Teléfono:* ${customerPhoneForMsg}\n`;
        if (mode === 'LOCAL') {
          msg += `🍽️ *Modalidad:* En el local - *${tableNumber || 'Mesa no especificada'}*\n`;
          if (isGroupOrder && window.groupCartManagerInstance?.participants?.size > 0) {
            msg += `👥 *Comensales en la mesa:* ${Array.from(window.groupCartManagerInstance.participants).join(', ')}\n\n`;
          } else {
            msg += `\n`;
          }
        } else if (mode === 'TAKEAWAY') {
          msg += `🛍️ *Modalidad:* Retiro en el local (Take Away)\n\n`;
        } else {
          const zoneName = zoneSelect.options[zoneSelect.selectedIndex]?.text || 'Zona no especificada';
          msg += `🛵 *Modalidad:* Envío a Domicilio\n`;
          msg += `📍 *Zona:* ${zoneName}\n`;
          msg += `🏠 *Dirección:* ${address || 'Dirección no especificada'}\n\n`;
        }

        msg += `*DETALLE DEL PEDIDO:*\n`;
        quote.itemsSnapshot.forEach((line, index) => {
          const authorTag = line.orderedBy ? ` (👤 ${line.orderedBy})` : '';
          msg += `▪ ${line.quantity}x ${line.name}${authorTag} - ${currency} ${line.totalItemAmount.toFixed(2)}\n`;
          const optionSummary = (line.optionsSnapshot || []).flatMap(group => (group.selections || []).map(selection => {
            const label = selection.quantity > 1 ? `${selection.quantity}x ${selection.name}` : selection.name;
            return group.kind === 'presentation' ? label : `${group.groupName}: ${label}`;
          })).join(', ');
          if (optionSummary) {
            const perPackage = line.quantity > 1 && (line.optionsSnapshot || []).some(group => group.kind === 'presentation');
            msg += `   ↳ ${perPackage ? 'Opciones por paquete' : 'Opciones'}: ${optionSummary}\n`;
          }
          if (line.note) msg += `   📝 Nota: ${line.note}\n`;
          const dish = items[index]?.dish;
          if (dish?.description && (dish.isCustomIceCream || (dish.id && dish.id.startsWith('perfume_')))) {
            msg += `   ↳ _${dish.description}_\n`;
          }
        });

        // Consolidación de pedidos para Cocina en pedidos grupales
        if (isGroupOrder && window.groupCartManagerInstance) {
          const consolidated = window.groupCartManagerInstance.consolidateOrder();
          if (consolidated.kitchenConsolidated.length > 0) {
            msg += `\n🍳 *CONSOLIDADO PARA COCINA:*\n`;
            consolidated.kitchenConsolidated.forEach(k => {
              msg += `▪ ${k.quantity}x ${k.name}\n`;
              if (k.notes.length) msg += `   ↳ ${k.notes.join(' | ')}\n`;
            });
          }
        }

        if (notes) msg += `\n📝 *Aclaraciones:* ${notes}\n`;
        msg += `\n💵 *Subtotal:* ${currency} ${subtotal.toFixed(2)}\n`;
        if (ctx.getAppliedCoupon() && currentDiscount > 0) msg += `🎟️ *Descuento Cupón (${ctx.getAppliedCoupon().code}):* -${currency} ${currentDiscount.toFixed(2)}\n`;
        if (mode === 'DELIVERY' && ctx.getDeliveryFee() > 0) msg += `🛵 *Envío:* ${currency} ${ctx.getDeliveryFee()}\n`;
        if (tipAmount > 0) msg += `🙌 *Propina:* ${currency} ${tipAmount.toFixed(2)}\n`;
        msg += `💰 *TOTAL A PAGAR:* ${currency} ${grandTotal.toFixed(2)}\n`;
        msg += `💳 *Método de Pago Seleccionado:* [${payment.toUpperCase()}]\n`;
        if (payment.includes('Transferencia')) msg += `ℹ️ _Se adjuntará el comprobante de transferencia por este chat._\n`;
        if (ctx.getRestaurantData().paymentLink) msg += `🔗 _Link de Pago:_ ${ctx.getRestaurantData().paymentLink}\n`;
        msg += `\n_Enviado desde ScanGo (Menú Digital)_`;

        // Registrar pedido en backend y guardar el token de seguimiento:
        // con él el comensal ve el estado (pendiente → preparando → listo)
        // aunque cierre WhatsApp, y recibe el push cuando el local lo avanza.
        // Turnstile invisible (solo si el despliegue lo configuró): el token
        // viaja como captchaToken; sin sitekey se envía sin nada.
        ctx.getCaptchaToken().then((captchaToken) => fetch('/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            restaurantId: ctx.getRestaurantData().id,
            tableNumber,
            customerName,
            customerPhone: ctx.getCustomerPhone(),
            deliveryAddress: mode === 'DELIVERY' ? address : '',
            orderMode: mode,
            currency,
            notes,
            isGroupOrder,
            coupon: ctx.getAppliedCoupon(),
            tipAmount,
            captchaToken: captchaToken || undefined,
            utcOffsetMinutes: -new Date().getTimezoneOffset(),
            participants: window.groupCartManagerInstance ? Array.from(window.groupCartManagerInstance.participants) : [],
            items: items.map(item => {
              const p = ctx.toOrderItemPayload(item);
              return {
                dishId: p.dishId,
                quantity: p.quantity,
                note: p.note,
                orderedBy: p.orderedBy,
                orderedById: p.orderedById,
                ...(p.customIceCream ? { customIceCream: p.customIceCream } : {}),
                choices: p.choices
              };
            })
          })
        })
          .then(res => res.json())
          .then(body => {
            const trackingToken = body && body.data && body.data.trackingToken;
            if (trackingToken) {
              ctx.saveOrderTracking({
                token: trackingToken,
                slug: ctx.getSlug(),
                restaurantName: ctx.getRestaurantData().name || '',
                tableNumber,
                createdAt: Date.now()
              });
              ctx.showOrderTrackingFab();
            }
          })
          .catch(() => {}));
        // Fin del registro en backend (el pedido real viaja por WhatsApp).

        if (isGroupOrder && window.groupCartManagerInstance) {
          window.groupCartManagerInstance.clearTableCart();
        }

        const rawPhone = (ctx.getRestaurantData().phone || '').replace(/[^0-9]/g, '');
        const waUrl = `https://wa.me/${rawPhone}?text=${encodeURIComponent(msg)}`;
        if (popup) popup.location = waUrl;
        else window.location.assign(waUrl);
        ctx.trackPublicEvent('order_placed', {
          amount: grandTotal,
          items: items.map(item => ({ dishId: item.dish.id, qty: item.qty })).slice(0, 100)
        });
      } catch (error) {
        if (popup) popup.close();
        alert(error.message || 'No se pudo preparar el pedido. Intentá nuevamente.');
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.dataset.submitting = 'false';
          btn.innerHTML = originalHtml;
        }
      }
    }
export { submitWhatsAppOrder };
