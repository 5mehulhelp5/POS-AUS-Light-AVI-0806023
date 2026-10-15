import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

// A purchase order sent to a wholesaler for customer backorders (Sally,
// 15 Oct 2026: a "Sent PO" button with the PO number, numbers generated
// by the POS and never duplicated). The backorder lines it covers carry
// the same po_number on order_items.
@Entity('purchase_orders')
export class PurchaseOrder {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @Index({ unique: true })
  @Column({ name: 'po_number', type: 'varchar', length: 40 })
  poNumber: string;

  @Column({ type: 'varchar', length: 120 })
  supplier: string;

  @Column({ name: 'line_count', type: 'int', unsigned: true, default: 0 })
  lineCount: number;

  @Column({ name: 'created_by', type: 'int', unsigned: true, nullable: true })
  createdBy: number | null;

  @Column({ name: 'created_by_name', type: 'varchar', length: 120, nullable: true })
  createdByName: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
