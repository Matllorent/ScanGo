/**
 * api/routes/events.js
 * ────────────────────
 * Eventos públicos (/api/events/*): Guest Companion por QR + aviso al mozo
 * con modo niños (push Realtime al staff). Extraído de api/index.js. FIX:
 * `getSupabaseClient()` se usaba sin importar (ReferenceError → 500 siempre
 * en waiter-call con Supabase); el router lo requiere bien.
 * Se monta como app.use('/api/events', eventsRouter).
 */
const express = require('express');
const db = require('../../src/db/db');
const telemetryService = require('../services/telemetry');
const { getSupabaseClient } = require('../utils/supabase');

const router = express.Router();

// GET /api/events/:slug/guest/:qrToken - Guest Companion page data
router.get('/:slug/guest/:qrToken', async (req, res, next) => {
  try {
    const { slug, qrToken } = req.params;
    
    const restaurant = db.findRestaurantBySlug(slug);
    if (!restaurant || (restaurant.businessType !== 'events' && !restaurant.isEvent)) {
      return res.status(404).json({ error: 'Evento no encontrado' });
    }
    
    // Buscar guest por qrToken
    const guests = restaurant.eventConfig?.guests || [];
    const guest = guests.find(g => g.qrToken === qrToken);
    if (!guest) {
      return res.status(404).json({ error: 'Invitado no encontrado' });
    }
    
    // Verificar expiración del evento
    const expiresAt = restaurant.expiresAt ? new Date(restaurant.expiresAt) : null;
    const eventDate = restaurant.eventDate ? new Date(restaurant.eventDate) : null;
    const expiryCheck = expiresAt || eventDate;
    if (expiryCheck && expiryCheck < new Date()) {
      return res.status(410).json({ 
        error: 'Evento finalizado',
        expired: true,
        message: 'Este evento ya ha finalizado. ¡Gracias por participar!'
      });
    }
    
    // Buscar padre si es niño
    let parentGuest = null;
    if (guest.isChild && guest.parentGuestId) {
      parentGuest = guests.find(g => g.id === guest.parentGuestId) || null;
    }
    
    // Construir respuesta completa para la Guest Page
    const response = {
      event: {
        slug: restaurant.slug,
        coupleNames: restaurant.eventConfig?.coupleNames || restaurant.name,
        eventType: restaurant.eventConfig?.eventType || 'wedding',
        eventDate: restaurant.eventDate,
        venue: restaurant.eventConfig?.venue,
        dressCode: restaurant.eventConfig?.dressCode,
        theme: restaurant.eventConfig?.theme || 'wedding_elegant',
        heroImage: restaurant.eventConfig?.heroImage || restaurant.bannerUrl,
        menuSections: restaurant.eventConfig?.menuSections || [],
        timeline: restaurant.eventConfig?.timeline || [],
        waiterConfig: restaurant.eventConfig?.waiterConfig || {},
        tables: restaurant.eventConfig?.tables || [],
        gifts: restaurant.eventConfig?.gifts || {}
      },
      guest: {
        id: guest.id,
        name: guest.name,
        isChild: guest.isChild || false,
        tableId: guest.tableId,
        tableName: guest.tableId ? (restaurant.eventConfig?.tables?.find(t => t.id === guest.tableId)?.name || guest.tableId) : null,
        seatNumber: guest.seatNumber,
        dietary: guest.dietary,
        allergens: guest.allergens || [],
        parentGuestId: guest.parentGuestId,
        parentContact: guest.parentContact,
        parentGuest: parentGuest ? {
          id: parentGuest.id,
          name: parentGuest.name,
          phone: parentGuest.phone
        } : null,
        qrToken: guest.qrToken
      }
    };
    
    res.json({ success: true, data: response });
  } catch (err) {
    next(err);
  }
});

// POST /api/events/:slug/waiter-call - Waiter call with kids mode support
router.post('/:slug/waiter-call', async (req, res, next) => {
  try {
    const { slug } = req.params;
    const { guestToken, categoryId, itemId, notes, kidMode } = req.body;
    
    const restaurant = db.findRestaurantBySlug(slug);
    if (!restaurant) return res.status(404).json({ error: 'Evento no encontrado' });
    
    const guests = restaurant.eventConfig?.guests || [];
    const guest = guests.find(g => g.qrToken === guestToken);
    if (!guest) return res.status(404).json({ error: 'Invitado no encontrado' });
    
    const tableName = guest.tableId ? (restaurant.eventConfig?.tables?.find(t => t.id === guest.tableId)?.name || guest.tableId) : 'Sin mesa';
    const isChild = guest.isChild || false;
    const allergens = guest.allergens?.length ? guest.allergens : [];
    
    // Construir payload para telemetría + staff push
    const callData = {
      eventId: restaurant.id,
      guestId: guest.id,
      guestName: guest.name,
      guestIsChild: isChild,
      tableName,
      seatNumber: guest.seatNumber,
      categoryId,
      itemId,
      notes: notes || '',
      allergens,
      kidMode: kidMode || false,
      timestamp: new Date().toISOString()
    };
    
    // Telemetría
    telemetryService.recordEvent({
      restaurantId: restaurant.id,
      eventType: 'event_waiter_call',
      metadata: callData
    });
    
    // Push a staff (Supabase Realtime channel: event_waiters_{slug})
    const supabase = getSupabaseClient();
    if (supabase) {
      let channel;
      try {
        channel = supabase.channel(`event_waiters_${slug}`, { config: { private: true } });
        await channel.send({ type: 'broadcast', event: 'waiter_call', payload: callData });
      } catch (e) {
        console.warn('[Event Waiter Push]', e.message);
      } finally {
        if (channel) {
          try {
            await supabase.removeChannel(channel);
          } catch (removeErr) {
            console.warn('[Event Waiter Push] Failed to remove channel:', removeErr.message);
          }
        }
      }
    }
    
    // Si es llamada a padres, log específico
    if (itemId === 'call_parent' && guest.parentContact?.whatsapp) {
      telemetryService.recordEvent({
        restaurantId: restaurant.id,
        eventType: 'kid_call_parent',
        metadata: { guestId: guest.id, parentContact: guest.parentContact }
      });
    }
    
    res.json({ success: true, callId: 'wc_' + Date.now() });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
