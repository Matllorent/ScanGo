/**
 * public/js/studio/notifications.js
 * ─────────────────────────────────
 * Push notifications Web (VAPID): el dueño activa los avisos de mesa en su
 * navegador. Cuando un comensal llama al mozo o pide la cuenta, le llega una
 * notificación aunque no esté mirando el Studio. Sin llaves VAPID en el
 * servidor, el aviso se degrada (sigue el flujo de WhatsApp, sin error).
 */

import { state } from './state.js';

function setPushStatus(text) {
  const status = document.getElementById('pushStatus');
  if (status) status.textContent = text;
}

function setUpButton(enabled) {
  const btn = document.getElementById('pushActivateBtn');
  if (btn) btn.disabled = !enabled;
}

/** Convierte un ArrayBuffer de la Push API a string base64url. */
function bufToBase64Url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Convierte la clave pública VAPID (base64url) a Uint8Array para subscribe(). */
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

function isPushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && window.isSecureContext;
}

async function refreshPushButton() {
  const btn = document.getElementById('pushActivateBtn');
  if (!isPushSupported()) {
    setPushStatus('Este navegador no soporta avisos push (se necesita Chrome/Edge con HTTPS).');
    setUpButton(false);
    return;
  }
  try {
    const reg = await navigator.serviceWorker.ready;
    const subscription = await reg.pushManager.getSubscription();
    if (subscription && Notification.permission === 'granted') {
      setPushStatus('Activados ✅ — te avisamos cuando una mesa llama.');
      setUpButton(false);
      if (btn) btn.textContent = '🔕 Desactivar';
    } else {
      setPushStatus('Apagados — no recibís avisos de mesa todavía.');
      setUpButton(true);
    }
  } catch (e) {
    setUpButton(true);
  }
}

/** Registra el service worker y refleja el estado actual del botón. */
export async function setupPushNotifications() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) {
    refreshPushButton();
    return;
  }
  try {
    await navigator.serviceWorker.register('/sw.js');
  } catch (e) {
    // Sin service worker no hay push; el botón lo refleja
  }
  refreshPushButton();
}

/** Botón del Studio: activa/desactiva los avisos de mesa. */
export async function solicitarPushPermiso() {
  const btn = document.getElementById('pushActivateBtn');
  if (!isPushSupported()) {
    setPushStatus('Este navegador no soporta avisos push (se necesita Chrome/Edge con HTTPS).');
    return;
  }
  try {
    // Si ya está activo, desactivamos (damos de baja local, sin borrar la fila)
    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    if (existing && Notification.permission === 'granted') {
      await existing.unsubscribe();
      setPushStatus('Apagados — no recibís avisos de mesa todavía.');
      if (btn) {
        btn.disabled = false;
        btn.textContent = '🔔 Activar notificaciones';
      }
      return;
    }

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      setPushStatus('Lo bloqueaste en el navegador. Volvé a permitirlo desde el candado de la barra de direcciones.');
      return;
    }

    let subscription = await reg.pushManager.getSubscription();
    if (!subscription) {
      const res = await fetch('/api/notifications/vapid-public-key');
      if (res.status === 503) {
        setPushStatus('El servidor todavía no configuró las llaves push. Avísale al equipo de ScanGo.');
        return;
      }
      const data = await res.json();
      if (!data?.data?.publicKey) {
        setPushStatus('El servidor todavía no configuró las llaves push.');
        return;
      }
      subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(data.data.publicKey)
      });
    }

    const res2 = await fetch('/api/notifications/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: state.currentUser?.id || null,
        restaurantId: state.restaurant?.id || '',
        endpoint: subscription.endpoint,
        keys: {
          p256dh: bufToBase64Url(subscription.getKey('p256dh')),
          auth: bufToBase64Url(subscription.getKey('auth'))
        }
      })
    });
    if (!res2.ok) throw new Error('No se pudo guardar la suscripción');
    setPushStatus('Activados ✅ — te avisamos cuando una mesa llama.');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '🔕 Desactivar';
    }
  } catch (e) {
    setPushStatus('Algo salió mal al activar los avisos. Probá de nuevo.');
  }
}