import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Quote } from './quote.entity';
import { Product } from '../../products/entities/product.entity';

@Entity('quote_items')
export class QuoteItem {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @Index()
  @Column({ name: 'quote_id', type: 'int', unsigned: true })
  quoteId: number;

  @Column({ name: 'product_id', type: 'int', unsigned: true })
  productId: number;

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

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  // Relations
  @ManyToOne(() => Quote, (quote) => quote.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'quote_id' })
  quote: Quote;

  @ManyToOne(() => Product)
  @JoinColumn({ name: 'product_id' })
  product: Product;
}
