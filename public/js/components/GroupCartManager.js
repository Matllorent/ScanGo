import { escapeHtml } from '/js/utils/escapeHtml.js';
/**
 * GroupCartManager.js — Pedido Grupal Colaborativo en Tiempo Real para Mesas
 * Conecta comensales de una misma mesa vía Supabase Realtime Channels.
 * Soporta recuperación offline/4G vía SessionStorage, atribución de platos y consolidación.
 */

export class GroupCartManager {
  /**
   * @param {Object} options
   * @param {Object} options.restaurantData - Datos del restaurante
   * @param {string} [options.restaurantSlug] - Slug del restaurante
   * @param {string|number} [options.tableNumber] - Número de mesa (ej: '4')
   * @param {Function} [options.onCartUpdate] - Callback ejecutado al sincronizar cambios en el carrito
   * @param {Function} [options.onNotification] - Callback para mostrar avisos toast al usuario
   * @param {Object} [options.supabaseClient] - Instancia de cliente Supabase (opcional)
   */
  constructor(options = {}) {
    this.restaurantData = options.restaurantData || {};
    this.restaurantSlug = options.restaurantSlug || this.restaurantData?.slug || 'default';
    this.restaurantId = options.restaurantData?.id || this.restaurantSlug;
    this.tableNumber = options.tableNumber || this.extractTableFromUrl();
    this.groupToken = options.groupToken || this.extractGroupToken();
    this.onCartUpdate = typeof options.onCartUpdate === 'function' ? options.onCartUpdate : null;
    this.onNotification = typeof options.onNotification === 'function' ? options.onNotification : this.defaultNotification.bind(this);
    this.supabaseClient = options.supabaseClient || (typeof window !== 'undefined' ? window.supabaseClient : null);

    this.userId = null;
    this.userName = null;
    this.channel = null;
    this.channelName = null;
    this.isSubscribed = false;
    this.participants = new Set();
    this.cart = {}; // Espejo local del carrito de la mesa

    this.sessionStorageKey = `scango_group_session_${this.restaurantSlug}_mesa_${this.tableNumber || 'none'}`;

    // Inicializar listeners de conectividad
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.handleNetworkReconnect());
      window.addEventListener('offline', () => this.handleNetworkOffline());
    }
  }

  /**
   * Extrae el número de mesa desde la URL actual (?mesa=X o ?table=X)
   */
  extractTableFromUrl() {
    if (typeof window === 'undefined' || !window.location) return null;
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('mesa') || urlParams.get('table') || null;
  }

  extractGroupToken() {
    if (typeof window === 'undefined' || !window.location) return null;
    return new URLSearchParams(window.location.hash.slice(1)).get('groupToken');
  }

  /**
   * Indica si la sesión actual corresponde a una mesa grupal activa
   */
  isGroupActive() {
    return Boolean(this.tableNumber && this.groupToken);
  }

  /**
   * Inicializa la sesión grupal:
   * 1. Recupera o solicita el nombre del comensal.
   * 2. Conecta al canal Supabase Realtime `realtime:restaurantSlug:mesa_X`.
   * 3. Sincroniza el estado inicial.
   */
  async init() {
    if (!this.isGroupActive()) {
      return false;
    }

    // 1. Recuperar sesión de sessionStorage ante pérdida de señal 4G o recarga
    this.restoreSession();

    // 2. Si no hay nombre de usuario, solicitarlo mediante modal
    if (!this.userName) {
      await this.promptUserNameModal();
    }

    // 3. Conectar a Supabase Realtime
    await this.connectRealtimeChannel();

    // 4. Renderizar barra superior de pedido grupal en mesa
    this.renderGroupHeaderBar();

    return true;
  }

  /**
   * Restaura datos de sesión persistidos en SessionStorage (resiliencia 4G / offline)
   */
  restoreSession() {
    try {
      const saved = sessionStorage.getItem(this.sessionStorageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        this.userId = parsed.userId || this.generateUserId();
        this.userName = parsed.userName || null;
        if (this.userName) {
          this.participants.add(this.userName);
        }
      } else {
        this.userId = this.generateUserId();
      }
    } catch (e) {
      this.userId = this.generateUserId();
    }
  }

  /**
   * Guarda los datos actuales en SessionStorage
   */
  saveSession() {
    try {
      const data = {
        userId: this.userId,
        userName: this.userName,
        tableNumber: this.tableNumber,
        restaurantSlug: this.restaurantSlug,
        updatedAt: Date.now()
      };
      sessionStorage.setItem(this.sessionStorageKey, JSON.stringify(data));
    } catch (e) {}
  }

  generateUserId() {
    return 'usr_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 5);
  }

  /**
   * Modal interactivo para solicitar el nombre del comensal
   */
  promptUserNameModal() {
    return new Promise((resolve) => {
      // Eliminar modal previo si existiese
      const prevModal = document.getElementById('groupUserNameModal');
      if (prevModal) prevModal.remove();

      const modalHtml = `
        <div id="groupUserNameModal" class="modal-overlay active" style="z-index: 99999; backdrop-filter: blur(8px);">
          <div class="modal-box" style="max-width: 380px; text-align: center; border: 1px solid var(--border-gold, #ECC94B); box-shadow: 0 10px 30px rgba(0,0,0,0.8);">
            <div style="font-size: 2.2rem; margin-bottom: 10px;">👋 👥</div>
            <h3 class="modal-title" style="color: var(--chalk-gold, #ECC94B); margin-bottom: 6px;">¡Mesa ${this.escapeHtml(this.tableNumber)}!</h3>
            <p style="color: var(--chalk-muted, #A0AEC0); font-size: 0.88rem; margin-bottom: 18px; line-height: 1.4;">
              Estás en el <strong>Pedido Grupal en Tiempo Real</strong>. ¿Cuál es tu nombre para sumarte al pedido de la mesa?
            </p>
            <form id="groupUserNameForm" onsubmit="event.preventDefault();">
              <div class="form-group" style="margin-bottom: 16px;">
                <input type="text" id="inputComensalName" class="form-input" placeholder="Ej: Juan, Sofía, Martín..." required autofocus maxlength="40" style="text-align: center; font-size: 1.05rem; font-weight: 600;">
              </div>
              <button type="submit" id="btnConfirmComensalName" class="btn-wa-submit" style="background: var(--chalk-gold, #ECC94B); color: #0E1412; font-weight: 700; font-size: 0.95rem;">
                <span>✨ Unirme al Pedido de la Mesa</span>
              </button>
            </form>
          </div>
        </div>
      `;

      document.body.insertAdjacentHTML('beforeend', modalHtml);
      const input = document.getElementById('inputComensalName');
      const form = document.getElementById('groupUserNameForm');

      if (input) setTimeout(() => input.focus(), 150);

      const handleConfirm = () => {
        const val = input ? input.value.trim() : '';
        if (!val) {
          if (input) input.style.borderColor = '#EF4444';
          return;
        }
        this.userName = val;
        this.participants.add(this.userName);
        this.saveSession();

        const modal = document.getElementById('groupUserNameModal');
        if (modal) modal.remove();

        // Actualizar campo de Tu Nombre en el modal de checkout si existe
        const nameField = document.getElementById('orderCustomerName');
        if (nameField && (!nameField.value || nameField.value === 'Cliente')) {
          nameField.value = this.userName;
        }

        resolve(this.userName);
      };

      if (form) {
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          handleConfirm();
        });
      }
    });
  }

  /**
   * Conecta a Supabase Realtime Channels usando el canal `realtime:restaurantSlug:mesa_X`
   */
  async connectRealtimeChannel() {
    if (!this.tableNumber) return;

    this.channelName = `realtime:${this.restaurantSlug}:mesa_${this.tableNumber}:${this.groupToken}`;

    // Obtener credenciales públicas si no existe cliente supabase aún
    if (!this.supabaseClient && typeof window !== 'undefined') {
      try {
        if (window.supabaseClient) {
          this.supabaseClient = window.supabaseClient;
        } else {
          const res = await fetch('/api/orders/realtime-config');
          const data = await res.json();
          if (data?.success && data?.data?.supabaseUrl && data?.data?.supabaseKey) {
            if (typeof window.supabase?.createClient === 'function') {
              this.supabaseClient = window.supabase.createClient(data.data.supabaseUrl, data.data.supabaseKey);
              window.supabaseClient = this.supabaseClient;
            }
          }
        }
      } catch (e) {
        console.warn('[GroupCartManager] Realtime config warning:', e.message);
      }
    }

    // Inicializar canal Supabase si el cliente está presente
    if (this.supabaseClient && typeof this.supabaseClient.channel === 'function') {
      try {
        if (this.channel) {
          this.channel.unsubscribe();
        }

        this.channel = this.supabaseClient.channel(this.channelName, {
          config: {
            broadcast: { self: false }
          }
        });

        // Escuchar evento de actualización del carrito
        this.channel.on('broadcast', { event: 'cart_update' }, (payload) => {
          this.handleIncomingCartUpdate(payload.payload);
        });

        // Escuchar solicitud de sincronización cuando un nuevo comensal se suma a la mesa
        this.channel.on('broadcast', { event: 'request_sync' }, (payload) => {
          this.handleIncomingRequestSync(payload.payload);
        });

        // Escuchar respuesta con estado sincronizado
        this.channel.on('broadcast', { event: 'sync_state' }, (payload) => {
          this.handleIncomingSyncState(payload.payload);
        });

        this.channel.subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            this.isSubscribed = true;
            this.updateConnectionBadge(true);
            // Solicitar carrito existente a los otros teléfonos de la mesa
            this.broadcast('request_sync', {
              fromUser: this.userName,
              fromUserId: this.userId,
              timestamp: Date.now()
            });
          } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
            this.isSubscribed = false;
            this.updateConnectionBadge(false);
          }
        });
      } catch (err) {
        console.warn('[GroupCartManager] Error subscribing to channel:', err.message);
      }
    }

    // Como respaldo o sync inicial, consultar el estado en el servidor
    await this.fetchServerTableCart();
  }

  /**
   * Consulta el estado del carrito de la mesa al backend
   */
  async fetchServerTableCart() {
    try {
      const res = await fetch(`/api/orders/group/${encodeURIComponent(this.restaurantId)}/${encodeURIComponent(this.tableNumber)}`, {
        headers: { 'X-Group-Cart-Token': this.groupToken }
      });
      const payload = await res.json();
      if (payload?.success && payload?.data?.items && payload.data.items.length > 0) {
        this.mergeIncomingItems(payload.data.items);
        if (payload.data.participants) {
          payload.data.participants.forEach(p => this.participants.add(p));
        }
        this.notifyCartChange('sync_initial');
      }
    } catch (e) {
      console.warn('[GroupCartManager] fetchServerTableCart:', e.message);
    }
  }

  /**
   * Respalda en el servidor el estado del carrito de la mesa
   */
  async syncToServer(action = 'update', item = null) {
    try {
      const itemsList = Object.values(this.cart);
      await fetch(`/api/orders/group/${encodeURIComponent(this.restaurantId)}/${encodeURIComponent(this.tableNumber)}/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Group-Cart-Token': this.groupToken
        },
        body: JSON.stringify({
          items: itemsList,
          participants: Array.from(this.participants),
          action,
          fromUser: this.userName,
          fromUserId: this.userId
        })
      });
    } catch (e) {}
  }

  /**
   * Limpia el carrito grupal de la mesa una vez que el pedido se consolida y envía
   */
  async clearTableCart() {
    this.cart = {};
    try {
      await fetch(`/api/orders/group/${encodeURIComponent(this.restaurantId)}/${encodeURIComponent(this.tableNumber)}/clear`, {
        method: 'POST',
        headers: { 'X-Group-Cart-Token': this.groupToken }
      });
      this.broadcast('cart_update', {
        action: 'clear',
        cart: {},
        fromUser: this.userName,
        fromUserId: this.userId
      });
    } catch (e) {}
  }

  /**
   * Transmite un mensaje por el canal Supabase Realtime
   */
  broadcast(event, payload) {
    if (this.channel && this.isSubscribed && typeof this.channel.send === 'function') {
      try {
        this.channel.send({
          type: 'broadcast',
          event,
          payload
        });
      } catch (e) {
        console.warn('[GroupCartManager] Broadcast warning:', e.message);
      }
    }
  }

  /**
   * Manejador de evento entrante `cart_update`
   */
  handleIncomingCartUpdate(data) {
    if (!data) return;

    // Si viene de este mismo dispositivo, ignorar
    if (data.fromUserId === this.userId) return;

    if (data.fromUser) {
      this.participants.add(data.fromUser);
    }

    if (data.action === 'clear') {
      this.cart = {};
      this.onNotification(`🧹 ${data.fromUser || 'La mesa'} vació el pedido grupal.`);
      this.notifyCartChange('remote_clear');
      return;
    }

    if (data.fullCart && typeof data.fullCart === 'object') {
      this.cart = data.fullCart;
    } else if (data.item) {
      if (data.action === 'add' || data.action === 'update_qty') {
        this.cart[data.item.cartItemId || data.cartItemId] = data.item;
      } else if (data.action === 'remove') {
        delete this.cart[data.cartItemId];
      }
    }

    // Mostrar feedback sutil al comensal
    const actionDesc = data.action === 'add'
      ? `agregó ${data.item?.dish?.name || 'un plato'}`
      : data.action === 'remove'
      ? `quitó un plato`
      : 'actualizó su pedido';

    this.onNotification(`👥 ${data.fromUser || 'Alguien en la mesa'} ${actionDesc}`);
    this.notifyCartChange(data.action);
  }

  /**
   * Responde cuando otro comensal recién ingresa y pide sincronizar
   */
  handleIncomingRequestSync(data) {
    if (!data || data.fromUserId === this.userId) return;
    if (data.fromUser) this.participants.add(data.fromUser);

    // Enviar el carrito actual al nuevo comensal
    const itemsCount = Object.keys(this.cart).length;
    if (itemsCount > 0) {
      this.broadcast('sync_state', {
        cart: this.cart,
        participants: Array.from(this.participants),
        toUserId: data.fromUserId,
        fromUser: this.userName,
        fromUserId: this.userId
      });
    }
    this.onNotification(`👋 ¡${data.fromUser || 'Un nuevo comensal'} se unió a la Mesa ${this.tableNumber}!`);
    this.renderGroupHeaderBar();
  }

  /**
   * Recibe el estado sincronizado de otro compañero de mesa
   */
  handleIncomingSyncState(data) {
    if (!data || data.toUserId !== this.userId) return;
    if (data.cart && typeof data.cart === 'object') {
      // Fusionar respetando items ya seleccionados
      this.cart = { ...data.cart, ...this.cart };
      if (data.participants) {
        data.participants.forEach(p => this.participants.add(p));
      }
      this.notifyCartChange('sync_received');
      this.renderGroupHeaderBar();
    }
  }

  /**
   * Fusiona items recibidos desde el servidor
   */
  mergeIncomingItems(itemsArray) {
    if (!Array.isArray(itemsArray)) return;
    itemsArray.forEach(item => {
      const id = item.cartItemId || `cart_${item.dish?.id || item.dishId}_${item.orderedById || 'anon'}`;
      if (!this.cart[id]) {
        this.cart[id] = item;
      }
    });
  }

  /**
   * Notifica a la interfaz de usuario que el carrito cambió
   */
  notifyCartChange(trigger = 'internal') {
    this.renderGroupHeaderBar();
    if (this.onCartUpdate) {
      this.onCartUpdate(this.cart, {
        trigger,
        tableNumber: this.tableNumber,
        participants: Array.from(this.participants),
        currentUserId: this.userId,
        currentUserName: this.userName
      });
    }
  }

  // ==========================================
  // RESTRICCIONES DE PROPIEDAD DE PLATOS
  // ==========================================

  /**
   * Verifica si el comensal actual tiene permiso para editar o eliminar un plato.
   * Regla: "Cada comensal solo puede editar o eliminar los platos creados bajo su propio nombre".
   */
  canEditItem(item) {
    if (!item) return false;
    // Si no está en modo mesa grupal, tiene control total
    if (!this.isGroupActive()) return true;

    // Verificar coincidencia de ID único de sesión o de nombre
    if (item.orderedById && item.orderedById === this.userId) return true;
    if (item.orderedBy && this.userName && item.orderedBy.toLowerCase() === this.userName.toLowerCase()) return true;

    // Si el item no tiene autor (pedidos previos a la sesión grupal), se permite edición
    if (!item.orderedById && !item.orderedBy) return true;

    return false;
  }

  /**
   * Agrega un plato al pedido grupal con atribución al nombre del comensal
   */
  addItem(dish, choices = [], note = '') {
    if (!this.userName) {
      this.promptUserNameModal().then(() => this.addItem(dish, choices, note));
      return null;
    }

    const cartItemId = `cart_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const newItem = {
      cartItemId,
      dish,
      qty: 1,
      note: note || '',
      choices: choices || [],
      orderedBy: this.userName, // "Juan: Hamburguesa Criolla"
      orderedById: this.userId,
      addedAt: Date.now()
    };

    this.cart[cartItemId] = newItem;

    // Transmitir evento `cart_update` en tiempo real
    this.broadcast('cart_update', {
      action: 'add',
      item: newItem,
      cartItemId,
      fullCart: this.cart,
      fromUser: this.userName,
      fromUserId: this.userId,
      tableNumber: this.tableNumber
    });

    this.syncToServer('add', newItem);
    this.notifyCartChange('local_add');
    return newItem;
  }

  /**
   * Modifica la cantidad de un plato con validación de propiedad
   */
  changeQty(cartItemId, delta) {
    const item = this.cart[cartItemId];
    if (!item) return false;

    // Restricción: solo el creador puede editarlo
    if (!this.canEditItem(item)) {
      this.onNotification(`⚠️ Solo ${item.orderedBy || 'quien lo pidió'} puede modificar este plato.`);
      return false;
    }

    item.qty += delta;
    let action = 'update_qty';

    if (item.qty <= 0) {
      delete this.cart[cartItemId];
      action = 'remove';
    }

    this.broadcast('cart_update', {
      action,
      item: item.qty > 0 ? item : null,
      cartItemId,
      fullCart: this.cart,
      fromUser: this.userName,
      fromUserId: this.userId,
      tableNumber: this.tableNumber
    });

    this.syncToServer(action, item);
    this.notifyCartChange('local_qty');
    return true;
  }

  /**
   * Elimina un plato del carrito grupal con validación de propiedad
   */
  removeItem(cartItemId) {
    const item = this.cart[cartItemId];
    if (!item) return false;

    if (!this.canEditItem(item)) {
      this.onNotification(`⚠️ Solo ${item.orderedBy || 'quien lo pidió'} puede eliminar este plato.`);
      return false;
    }

    delete this.cart[cartItemId];

    this.broadcast('cart_update', {
      action: 'remove',
      cartItemId,
      fullCart: this.cart,
      fromUser: this.userName,
      fromUserId: this.userId,
      tableNumber: this.tableNumber
    });

    this.syncToServer('remove', item);
    this.notifyCartChange('local_remove');
    return true;
  }

  /**
   * Modifica la nota de un plato con validación de propiedad
   */
  updateNote(cartItemId, newNote) {
    const item = this.cart[cartItemId];
    if (!item) return false;

    if (!this.canEditItem(item)) {
      this.onNotification(`⚠️ Solo ${item.orderedBy || 'quien lo pidió'} puede editar notas de este plato.`);
      return false;
    }

    item.note = newNote;

    this.broadcast('cart_update', {
      action: 'edit_note',
      item,
      cartItemId,
      fullCart: this.cart,
      fromUser: this.userName,
      fromUserId: this.userId,
      tableNumber: this.tableNumber
    });

    this.syncToServer('edit_note', item);
    this.notifyCartChange('local_note');
    return true;
  }

  // ==========================================
  // CONSOLIDACIÓN DEL PEDIDO GRUPAL
  // ==========================================

  /**
   * Consolida el pedido completo agrupado por comensal y con totales para cocina
   */
  consolidateOrder() {
    const items = Object.values(this.cart);
    const byParticipant = {};
    const consolidatedKitchen = {};
    let grandTotal = 0;

    items.forEach(item => {
      const author = item.orderedBy || 'Comensal';
      if (!byParticipant[author]) {
        byParticipant[author] = {
          participantName: author,
          items: [],
          subtotal: 0
        };
      }
      byParticipant[author].items.push(item);
      const unitPrice = item.dish?.price || 0;
      const lineTotal = unitPrice * item.qty;
      byParticipant[author].subtotal += lineTotal;
      grandTotal += lineTotal;

      // Consolidado de cocina (acumula cantidades idénticas de platos)
      const dishKey = item.dish?.id || item.dish?.name;
      if (!consolidatedKitchen[dishKey]) {
        consolidatedKitchen[dishKey] = {
          dishId: item.dish?.id,
          name: item.dish?.name,
          quantity: 0,
          unitPrice,
          notes: []
        };
      }
      consolidatedKitchen[dishKey].quantity += item.qty;
      if (item.note) {
        consolidatedKitchen[dishKey].notes.push(`${author}: ${item.note}`);
      }
    });

    return {
      tableNumber: this.tableNumber,
      participants: Object.keys(byParticipant),
      participantCount: Object.keys(byParticipant).length,
      byParticipant,
      kitchenConsolidated: Object.values(consolidatedKitchen),
      grandTotal,
      totalItemsCount: items.reduce((sum, it) => sum + it.qty, 0)
    };
  }

  /**
   * Genera el texto de WhatsApp consolidado para la mesa y cocina
   */
  formatWhatsAppGroupMessage(quoteData = {}, metadata = {}) {
    const consolidated = this.consolidateOrder();
    const currency = this.restaurantData.currency || '$';
    const restName = (this.restaurantData.name || 'ScanGo').toUpperCase();

    let text = `👥 *PEDIDO GRUPAL COLABORATIVO - MESA ${this.tableNumber}*\n`;
    text += `🏪 *${restName}*\n`;
    text += `👥 *Comensales en la mesa (${consolidated.participantCount}):* ${consolidated.participants.join(', ')}\n\n`;

    text += `━━━━━━━━━━━━━━━━━━━━\n`;
    text += `📋 *DETALLE POR COMENSAL:*\n`;

    Object.entries(consolidated.byParticipant).forEach(([person, data]) => {
      text += `\n👤 *${person}* (Subtotal: ${currency} ${data.subtotal.toFixed(2)}):\n`;
      data.items.forEach(item => {
        text += `  ▪ ${item.qty}x ${item.dish?.name} - ${currency} ${(item.qty * (item.dish?.price || 0)).toFixed(2)}\n`;
        if (item.note) {
          text += `     ↳ 📝 Nota: ${item.note}\n`;
        }
      });
    });

    text += `\n━━━━━━━━━━━━━━━━━━━━\n`;
    text += `🍳 *CONSOLIDADO PARA COCINA:*\n`;
    consolidated.kitchenConsolidated.forEach(k => {
      text += `  ▪ ${k.quantity}x ${k.name}\n`;
      if (k.notes.length > 0) {
        text += `     ↳ ${k.notes.join(' | ')}\n`;
      }
    });

    text += `\n━━━━━━━━━━━━━━━━━━━━\n`;
    text += `💰 *TOTAL GENERAL MESA:* ${currency} ${consolidated.grandTotal.toFixed(2)}\n`;
    if (metadata.paymentMethod) {
      text += `💳 *Forma de pago:* [${metadata.paymentMethod.toUpperCase()}]\n`;
    }
    text += `🕒 *Hora:* ${new Date().toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit' })}\n`;
    text += `_Pedido colaborativo generado desde ScanGo Menú Pizarrón_`;

    return text;
  }

  // ==========================================
  // MANEJO DE RED & RECUPERACIÓN 4G
  // ==========================================

  handleNetworkOffline() {
    this.updateConnectionBadge(false, 'Sin señal 4G (Datos guardados localmente)');
  }

  handleNetworkReconnect() {
    this.updateConnectionBadge(true, 'Conectando...');
    this.restoreSession();
    this.connectRealtimeChannel();
    this.onNotification('🟢 Señal restablecida. Sincronizando pedido de la mesa...');
  }

  // ==========================================
  // COMPONENTES UI Y BADGES EN PANTALLA
  // ==========================================

  /**
   * Renderiza la barra flotante informativa superior de Pedido Grupal
   */
  renderGroupHeaderBar() {
    if (!this.isGroupActive()) return;

    let bar = document.getElementById('groupTableTopBar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'groupTableTopBar';
      bar.className = 'group-table-top-bar';
      document.body.prepend(bar);
    }

    const participantsList = Array.from(this.participants).join(', ') || this.userName || 'Tú';
    const totalCount = Object.values(this.cart).reduce((s, it) => s + it.qty, 0);

    bar.innerHTML = `
      <div class="group-bar-content">
        <span class="group-pulse-dot" title="En vivo"></span>
        <span class="group-table-title">Mesa ${this.escapeHtml(this.tableNumber)} • 👥 Pedido Grupal</span>
        <span class="group-user-tag" title="Tu nombre en la mesa">👤 <strong>${this.escapeHtml(this.userName || 'Comensal')}</strong></span>
        <span class="group-counter-tag">🛒 ${totalCount} ítems</span>
        <button type="button" class="btn-group-name-edit" onclick="window.groupCartManagerInstance?.promptUserNameModal()" title="Cambiar mi nombre">✏️</button>
      </div>
    `;
    bar.style.display = 'block';
  }

  updateConnectionBadge(isOnline, customText = '') {
    const dot = document.querySelector('.group-pulse-dot');
    if (dot) {
      dot.style.background = isOnline ? '#4ade80' : '#f87171';
      dot.title = customText || (isOnline ? 'Conectado a la mesa en tiempo real' : 'Reconectando señal...');
    }
  }

  defaultNotification(message) {
    let toast = document.getElementById('groupToastNotification');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'groupToastNotification';
      toast.className = 'group-toast-notification';
      document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(this._toastTimeout);
    this._toastTimeout = setTimeout(() => {
      toast.classList.remove('visible');
    }, 3800);
  }

  
}

if (typeof window !== 'undefined') {
  window.GroupCartManager = GroupCartManager;
}
