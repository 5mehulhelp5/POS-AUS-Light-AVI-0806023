import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Order } from './order.entity';
import { Product } from '../../products/entities/product.entity';

@Entity('order_items')
export class OrderItem {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @Index()
  @Column({ name: 'order_id', type: 'int', unsigned: true })
  orderId: number;

  @Index()
  @Column({ name: 'product_id', type: 'int', unsigned: true, nullable: true })
  productId: number | null;

  @Column({ type: 'varchar', length: 100 })
  sku: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'int', unsigned: true })
  quantity: number;

  @Column({ name: 'unit_price', type: 'decimal', precision: 12, scale: 4 })
  unitPrice: number;

  @Column({
    name: 'discount_percent',
    type: 'decimal',
    // 6 decimals: a fixed trade price is carried as its exact % off
    // retail (e.g. 21.886970), and 2 decimals would drift a cent or two
    // when an open order / quote is re-priced from the stored value.
    precision: 9,
    scale: 6,
    default: 0,
  })
  discountPercent: number;

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

  @Column({ name: 'row_total', type: 'decimal', precision: 12, scale: 4 })
  rowTotal: number;

  @Column({
    name: 'cost_price',
    type: 'decimal',
    precision: 12,
    scale: 4,
    nullable: true,
  })
  costPrice: number | null;

  // Backorder tracking. `isBackorder` is true when stock wasn't available
  // at time of sale and the customer agreed to wait. `backorderFulfilledAt`
  // is set when a manager marks the item as received.
  @Index()
  @Column({ name: 'is_backorder', type: 'boolean', default: false })
  isBackorder: boolean;

  @Column({ name: 'backorder_fulfilled_at', type: 'timestamp', nullable: true })
  backorderFulfilledAt: Date | null;

  // Layby hold. True means the item stays with the store until the layby
  // balance is paid in full — even though stock was available at time
  // of sale. Lets a single order mix "take now" lines with held lines:
  // customer walks out with the non-held items, leaves the held items
  // behind, and collects them once the balance is cleared.
  @Index()
  @Column({ name: 'is_layby_held', type: 'boolean', default: false })
  isLaybyHeld: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  // Relations
  @ManyToOne(() => Order, (order) => order.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order: Order;

  @ManyToOne(() => Product, (product) => product.orderItems)
  @JoinColumn({ name: 'product_id' })
  product: Product;
}
