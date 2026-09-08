import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  OneToMany,
  ManyToMany,
  JoinTable,
} from 'typeorm';
import { Category } from './category.entity';
import { ProductAttribute } from './product-attribute.entity';
import { OrderItem } from '../../orders/entities/order-item.entity';

export enum ProductType {
  SIMPLE = 'simple',
  CONFIGURABLE = 'configurable',
  BUNDLE = 'bundle',
  GROUPED = 'grouped',
  VIRTUAL = 'virtual',
}

@Entity('products')
export class Product {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @Column({ name: 'magento_id', type: 'int', unsigned: true, unique: true })
  magentoId: number;

  @Column({ type: 'varchar', length: 100, unique: true })
  sku: string;

  @Index({ fulltext: true })
  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'short_description', type: 'text', nullable: true })
  shortDescription: string | null;

  @Column({ type: 'decimal', precision: 12, scale: 4 })
  price: number;

  @Column({
    name: 'special_price',
    type: 'decimal',
    precision: 12,
    scale: 4,
    nullable: true,
  })
  specialPrice: number | null;

  @Column({ name: 'special_price_from', type: 'date', nullable: true })
  specialPriceFrom: Date | null;

  @Column({ name: 'special_price_to', type: 'date', nullable: true })
  specialPriceTo: Date | null;

  @Column({ type: 'decimal', precision: 12, scale: 4, nullable: true })
  cost: number | null;

  @Column({ type: 'decimal', precision: 10, scale: 4, nullable: true })
  weight: number | null;

  @Column({ name: 'stock_qty', type: 'int', default: 0 })
  stockQty: number;

  @Index()
  @Column({ name: 'is_in_stock', type: 'boolean', default: true })
  isInStock: boolean;

  @Column({ name: 'manage_stock', type: 'boolean', default: true })
  manageStock: boolean;

  @Column({ name: 'tax_class_id', type: 'int', unsigned: true, nullable: true })
  taxClassId: number | null;

  @Column({ name: 'image_url', type: 'varchar', length: 500, nullable: true })
  imageUrl: string | null;

  @Column({
    name: 'thumbnail_url',
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  thumbnailUrl: string | null;

  @Index()
  @Column({ type: 'varchar', length: 100, nullable: true })
  barcode: string | null;

  // Brand / wholesaler name (e.g. "Havit", "Domus"). Populated by the
  // Magento sync from the `manufacturer` / `brand` attribute — the sync
  // caches the attribute options map so we store the human label, not
  // the numeric option id.
  @Index()
  @Column({ type: 'varchar', length: 200, nullable: true })
  brand: string | null;

  @Column({
    name: 'product_type',
    type: 'enum',
    enum: ProductType,
    default: ProductType.SIMPLE,
  })
  productType: ProductType;

  @Column({ name: 'parent_id', type: 'int', unsigned: true, nullable: true })
  parentId: number | null;

  @Index()
  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ name: 'synced_at', type: 'timestamp', nullable: true })
  syncedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  // Relations
  @ManyToMany(() => Category, (category) => category.products)
  @JoinTable({
    name: 'product_categories',
    joinColumn: { name: 'product_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'category_id', referencedColumnName: 'id' },
  })
  categories: Category[];

  @OneToMany(() => ProductAttribute, (attr) => attr.product)
  attributes: ProductAttribute[];

  @OneToMany(() => OrderItem, (orderItem) => orderItem.product)
  orderItems: OrderItem[];

  // Treat as on-sale only when:
  //  - special price is set, > 0, and STRICTLY less than the regular price
  //    (Magento sometimes ships specialPrice == price or higher, which we ignore)
  //  - today is between specialPriceFrom (inclusive) and specialPriceTo (inclusive)
  get isOnSale(): boolean {
    return Product.isOnSale(
      this.price,
      this.specialPrice,
      this.specialPriceFrom,
      this.specialPriceTo,
    );
  }

  get effectivePrice(): number {
    return this.isOnSale ? Number(this.specialPrice) : Number(this.price);
  }

  // A product ALSO counts as on-sale for display and discount-exclusion
  // when Magento put it in a Sale/Clearance category without setting a
  // special price (Sally, 7 Sep: the Coolum range carries the site's
  // Sale tag this way). Same category rule as the trade-discount
  // engine's clearance carve-out. Only meaningful when the categories
  // relation is loaded — false otherwise.
  get isInSaleCategory(): boolean {
    return (this.categories || []).some((c) => {
      const n = (c.name || '').trim().toLowerCase();
      return /clearance/.test(n) || n === 'sale';
    });
  }

  static isOnSale(
    price: number | string | null | undefined,
    specialPrice: number | string | null | undefined,
    from: Date | string | null | undefined,
    to: Date | string | null | undefined,
  ): boolean {
    if (specialPrice == null || price == null) return false;
    const sp = Number(specialPrice);
    const p = Number(price);
    if (!(sp > 0) || !(p > 0)) return false;
    if (sp >= p) return false;
    const now = Date.now();
    if (from) {
      const f = from instanceof Date ? from.getTime() : new Date(from).getTime();
      if (Number.isFinite(f) && f > now) return false;
    }
    if (to) {
      // Magento `to` is a date (no time), so include the whole day
      const t = to instanceof Date ? to.getTime() : new Date(to).getTime();
      if (Number.isFinite(t) && t + 24 * 60 * 60 * 1000 - 1 < now) return false;
    }
    return true;
  }
}
