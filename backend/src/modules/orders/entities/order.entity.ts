import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm';
import { Customer } from '../../customers/entities/customer.entity';
import { User } from '../../users/entities/user.entity';
import { OrderItem } from './order-item.entity';
import { Payment } from '../../payments/entities/payment.entity';

export enum OrderStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETE = 'complete',
  CANCELLED = 'cancelled',
  REFUND_IN_PROCESS = 'refund_in_process',
  REFUNDED = 'refunded',
  // Layby lifecycle: customer paid a deposit, owes the balance, stock is held.
  LAYBY_ACTIVE = 'layby_active',
  // Passed expiry without full payment. Admin decides whether to refund or
  // forfeit the deposit and release the stock.
  LAYBY_EXPIRED = 'layby_expired',
  // At least one line item couldn't be fulfilled immediately (out of stock
  // at the time of sale). Becomes complete once all backorder items are
  // received and fulfilled.
  BACKORDER_PENDING = 'backorder_pending',
}

export enum OrderType {
  STANDARD = 'standard',
  LAYBY = 'layby',
}

export enum DeliveryType {
  PICKUP = 'pickup',
  DELIVERY = 'delivery',
  LOCAL_METRO = 'local_metro',
  AUSTPOST = 'austpost',
}

// Fee added to the grand total per delivery method. Server reapplies
// these on order creation so the cashier's UI and the server total
// agree even if the client posts a wrong fee.
export const DELIVERY_FEES: Record<DeliveryType, number> = {
  [DeliveryType.PICKUP]: 0,
  [DeliveryType.DELIVERY]: 60,
  [DeliveryType.LOCAL_METRO]: 45,
  [DeliveryType.AUSTPOST]: 14.95,
};

// Back-compat re-export so existing imports of DELIVERY_FEE keep working
// (refers to the standard Delivery tier).
export const DELIVERY_FEE = DELIVERY_FEES[DeliveryType.DELIVERY];

export enum PaymentStatus {
  PENDING = 'pending',
  PARTIAL = 'partial',
  PAID = 'paid',
  REFUNDED = 'refunded',
}

export enum OrderSyncStatus {
  PENDING = 'pending',
  SYNCED = 'synced',
  FAILED = 'failed',
}

export enum OrderSource {
  POS = 'pos',
  MAGENTO = 'magento',
}

@Entity('orders')
export class Order {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @Column({ name: 'order_number', type: 'varchar', length: 50, unique: true })
  orderNumber: string;

  @Index()
  @Column({
    name: 'magento_order_id',
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  magentoOrderId: string | null;

  @Column({
    name: 'magento_increment_id',
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  magentoIncrementId: string | null;

  @Index()
  @Column({ name: 'customer_id', type: 'int', unsigned: true, nullable: true })
  customerId: number | null;

  @Index()
  @Column({ name: 'user_id', type: 'int', unsigned: true })
  userId: number;

  // Totals
  @Column({ type: 'decimal', precision: 12, scale: 4 })
  subtotal: number;

  @Column({
    name: 'discount_amount',
    type: 'decimal',
    precision: 12,
    scale: 4,
    default: 0,
  })
  discountAmount: number;

  @Column({ name: 'tax_amount', type: 'decimal', precision: 12, scale: 4 })
  taxAmount: number;

  @Column({ name: 'grand_total', type: 'decimal', precision: 12, scale: 4 })
  grandTotal: number;

  // Tax details
  @Column({
    name: 'tax_rate',
    type: 'decimal',
    precision: 5,
    scale: 4,
    default: 0.1,
  })
  taxRate: number;

  @Index()
  @Column({
    type: 'enum',
    enum: OrderStatus,
    default: OrderStatus.PENDING,
  })
  status: OrderStatus;

  @Column({
    name: 'payment_status',
    type: 'enum',
    enum: PaymentStatus,
    default: PaymentStatus.PENDING,
  })
  paymentStatus: PaymentStatus;

  // Sync tracking
  @Index()
  @Column({
    name: 'sync_status',
    type: 'enum',
    enum: OrderSyncStatus,
    default: OrderSyncStatus.PENDING,
  })
  syncStatus: OrderSyncStatus;

  @Column({ name: 'sync_attempts', type: 'int', unsigned: true, default: 0 })
  syncAttempts: number;

  @Column({ name: 'sync_error', type: 'text', nullable: true })
  syncError: string | null;

  @Column({ name: 'synced_at', type: 'timestamp', nullable: true })
  syncedAt: Date | null;

  // Customer-facing note — printed on the invoice (Sally, 26 Aug).
  @Column({ type: 'text', nullable: true })
  notes: string | null;

  // Staff-only note — never printed, shown in the POS order drawer.
  @Column({ name: 'internal_notes', type: 'text', nullable: true })
  internalNotes: string | null;

  // Snapshot of the customer name at order time. Populated for walk-in
  // orders (no customer FK) so the orders list can still show a name
  // instead of just "Walk-in". Ignored when customerId is set — the
  // linked Customer row is the source of truth in that case.
  @Column({
    name: 'customer_name_snapshot',
    type: 'varchar',
    length: 200,
    nullable: true,
  })
  customerNameSnapshot: string | null;

  @Index()
  @Column({
    type: 'enum',
    enum: OrderSource,
    default: OrderSource.POS,
  })
  source: OrderSource;

  // Layby/backorder metadata. orderType distinguishes a layby from a normal
  // sale; laybyExpiresAt is the latest date the balance must be paid by.
  @Index()
  @Column({
    name: 'order_type',
    type: 'enum',
    enum: OrderType,
    default: OrderType.STANDARD,
  })
  orderType: OrderType;

  @Column({ name: 'layby_expires_at', type: 'timestamp', nullable: true })
  laybyExpiresAt: Date | null;

  // Exchange link. When this order is the replacement half of an
  // exchange, this points at the original order whose item(s) were
  // returned. The original order can be found by querying orders with
  // exchangeFromOrderId = its id (the "exchanged to" direction).
  @Index()
  @Column({
    name: 'exchange_from_order_id',
    type: 'int',
    unsigned: true,
    nullable: true,
  })
  exchangeFromOrderId: number | null;

  // Pickup vs delivery — chosen at checkout. Pickup is free, delivery
  // adds DELIVERY_FEE to the grand total. Stored on the order so the
  // invoice / receipts can render the line item afterwards.
  @Column({
    name: 'delivery_type',
    type: 'enum',
    enum: DeliveryType,
    default: DeliveryType.PICKUP,
  })
  deliveryType: DeliveryType;

  @Column({
    name: 'delivery_fee',
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 0,
  })
  deliveryFee: number;

  // Cashier-picked delivery region (local vs interstate) — informational,
  // used by the warehouse to decide dispatch flow. Doesn't affect the
  // charged fee (that's set by deliveryType).
  @Column({
    name: 'delivery_region',
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  deliveryRegion: string | null;

  @Index()
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  // Relations
  @ManyToOne(() => Customer, (customer) => customer.orders, {
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'customer_id' })
  customer: Customer | null;

  @ManyToOne(() => User, (user) => user.orders)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @OneToMany(() => OrderItem, (item) => item.order, { cascade: true })
  items: OrderItem[];

  @OneToMany(() => Payment, (payment) => payment.order, { cascade: true })
  payments: Payment[];
}
