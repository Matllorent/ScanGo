export interface Translations {
  es?: { name?: string; description?: string };
  en?: { name?: string; description?: string };
  pt?: { name?: string; description?: string };
  [key: string]: any;
}

export interface User {
  id: string;
  email: string;
  password?: string;
  name?: string;
  email_confirmed_at?: string | null;
  emailConfirmedAt?: string | null;
  created_at?: string;
  createdAt?: string;
  updated_at?: string;
  updatedAt?: string;
}

export interface Dish {
  id: string;
  categoryId: string;
  name: string;
  price: number;
  previous_price?: number | null;
  previousPrice?: number | null;
  description?: string;
  photoUrl?: string | null;
  photo_url?: string | null;
  outOfStock?: boolean;
  tags?: string[];
  is_chef_recommended?: boolean;
  isChefRecommended?: boolean;
  available_hours?: string[] | string;
  availableHours?: string[];
  available_days?: number[];
  availableDays?: number[];
  translations?: Translations;
}

export interface Category {
  id: string;
  name: string;
}

export interface DeliveryZone {
  name: string;
  fee: number;
}

export interface CustomCoupon {
  code: string;
  type: 'free_delivery' | 'percent';
  value: number;
  label?: string;
}

export interface TeamMember {
  email: string;
  role: 'admin' | 'waiter' | 'kitchen';
  name?: string;
  addedAt?: string;
}

export interface Subscription {
  status: 'active' | 'trialing' | 'past_due' | 'canceled' | 'paused';
  plan?: string;
  planId?: string;
  validUntil?: string;
  provider?: string;
  customerId?: string;
  subscriptionId?: string;
  created_at?: string;
  createdAt?: string;
}

export interface Analytics {
  visits: number;
  orders: number;
  reservations: number;
  waiterCalls: number;
  lastUpdated?: string;
}

export interface WifiConfig {
  ssid: string;
  password: string;
}

export interface Restaurant {
  id: string;
  user_id?: string;
  userId: string;
  name: string;
  biz_name?: string;
  bizName?: string;
  slug: string;
  slogan?: string;
  currency: string;
  phone: string;
  theme?: string;
  themeFont?: string;
  wifi?: WifiConfig;
  instagram?: string;
  googleReview?: string;
  allowReservations?: boolean;
  allowCoupons?: boolean;
  allowBillSplitter?: boolean;
  announcement?: string;
  paymentLink?: string;
  scheduleEnabled?: boolean;
  scheduleActiveHours?: string;
  tableCount?: number;
  logo_url?: string | null;
  logoUrl?: string | null;
  categories: Category[];
  dishes: Dish[];
  delivery_zones?: DeliveryZone[];
  deliveryZones?: DeliveryZone[];
  customCoupons?: CustomCoupon[];
  teamMembers?: TeamMember[];
  subscription?: Subscription;
  analytics?: Analytics;
  created_at?: string;
  createdAt?: string;
  updated_at?: string;
  updatedAt?: string;
}

export interface PushSubscriptionKeys {
  p256dh: string;
  auth: string;
}

export interface PushSubscription {
  id: string;
  user_id?: string;
  restaurant_id?: string;
  endpoint: string;
  keys: PushSubscriptionKeys;
  created_at: string;
}

export interface OrderItemSnapshot {
  dishId: string;
  name: string;
  unitPrice: number;
  unitPriceInCents: number;
  quantity: number;
  totalItemAmount: number;
  totalItemAmountInCents: number;
  categoryName?: string;
  optionsSnapshot?: Record<string, any>;
  snapshotTimestamp: string;
}

export interface Order {
  id: string;
  restaurant_id?: string;
  restaurantId: string;
  table_number?: string;
  tableNumber?: number | string;
  items_snapshot?: OrderItemSnapshot[];
  itemsSnapshot?: OrderItemSnapshot[];
  amount?: number;
  amount_in_cents?: number;
  total: number;
  currency: string;
  status: 'pending' | 'preparing' | 'delivered' | 'cancelled' | 'completed';
  customer_name?: string;
  customerName?: string;
  customer_phone?: string;
  customerPhone?: string;
  delivery_address?: string;
  deliveryAddress?: string;
  notes?: string;
  created_at: string;
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

export interface Webhook {
  id: string | number;
  provider: 'mercadopago' | 'stripe' | 'dlocal' | 'lemonsqueezy' | string;
  event_id?: string;
  event?: string;
  payload?: Record<string, any>;
  data?: Record<string, any>;
  timestamp?: string | Date;
  status?: 'received' | 'processed' | 'failed';
  signature?: string;
  error?: string;
}

export interface Review {
  id: string;
  restaurant_id: string;
  restaurantId?: string;
  rating: number;
  comment: string;
  author_photo_url?: string | null;
  authorPhotoUrl?: string | null;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
}

export interface ProcessedWebhook {
  id?: string | number;
  provider: string;
  event_id: string;
  processed_at: string;
}

export interface HealthStatus {
  status: 'healthy' | 'degraded';
  timestamp: string;
  uptimeSeconds: number;
  environment: string;
  database: {
    connected: boolean;
    provider: string;
    latencyMs: number;
  };
  memory: {
    heapUsedMb: number;
    heapTotalMb: number;
    rssMb: number;
  };
}
