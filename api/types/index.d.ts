export interface User {
  id: string;
  email: string;
  password?: string;
  name?: string;
  email_confirmed_at?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface Dish {
  id: string;
  categoryId: string;
  name: string;
  price: number;
  description?: string;
  photoUrl?: string | null;
  outOfStock?: boolean;
  tags?: string[];
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
  planId?: string;
  validUntil?: string;
  provider?: string;
  customerId?: string;
  subscriptionId?: string;
  createdAt?: string;
}

export interface Analytics {
  visits: number;
  orders: number;
  reservations: number;
  waiterCalls: number;
}

export interface WifiConfig {
  ssid: string;
  password: string;
}

export interface Restaurant {
  id: string;
  userId: string;
  name: string;
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
  logoUrl?: string | null;
  categories: Category[];
  dishes: Dish[];
  deliveryZones?: DeliveryZone[];
  customCoupons?: CustomCoupon[];
  teamMembers?: TeamMember[];
  subscription?: Subscription;
  analytics?: Analytics;
  createdAt?: string;
  updatedAt?: string;
}

export interface OrderItem {
  dishId: string;
  name: string;
  price: number;
  quantity: number;
  options?: Record<string, any>;
}

export interface Order {
  id: string;
  restaurantId: string;
  tableNumber?: number | string;
  items: OrderItem[];
  total: number;
  status: 'pending' | 'preparing' | 'delivered' | 'cancelled' | 'completed';
  customerName?: string;
  customerPhone?: string;
  deliveryAddress?: string;
  paymentMethod?: string;
  notes?: string;
  createdAt: string | Date;
  updatedAt?: string | Date;
}

export interface Webhook {
  id: string;
  provider: 'mercadopago' | 'stripe' | 'dlocal' | 'lemonsqueezy' | string;
  event: string;
  payload: Record<string, any>;
  timestamp: string | Date;
  status: 'received' | 'processed' | 'failed';
  signature?: string;
  error?: string;
}

export interface Review {
  id: string;
  restaurant_id: string;
  rating: number;
  comment: string;
  author_photo_url?: string | null;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
}

export interface ProcessedWebhook {
  id?: string;
  provider: string;
  event_id: string;
  processed_at: string;
}
