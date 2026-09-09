import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

// Audit trail for actions on an order that aren't already recorded in a
// dedicated table (Sally, 9 Sep: "create a history section to show what
// actions have happened to the order"). Refunds, payments, exchanges and
// backorder fulfilments are derived from their own tables — this log
// covers the rest, primarily item add/remove/qty/price edits from the
// "Add Lights" / Edit Items flow. `description` is written as final
// display text (including who did it) so rendering needs no joins.
@Entity('order_events')
export class OrderEvent {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @Index()
  @Column({ name: 'order_id', type: 'int', unsigned: true })
  orderId: number;

  @Column({ name: 'user_id', type: 'int', unsigned: true, nullable: true })
  userId: number | null;

  // e.g. 'items_changed'
  @Column({ type: 'varchar', length: 40 })
  type: string;

  @Column({ type: 'text' })
  description: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
