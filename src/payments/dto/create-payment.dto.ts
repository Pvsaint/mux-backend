import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsPositive,
  IsOptional,
  IsInt,
  MaxLength,
} from 'class-validator';

export class CreatePaymentDto {
  /** Sender wallet UUID — validated to exist and be ACTIVE before payment is created. */
  @IsString()
  @IsNotEmpty()
  walletId: string;

  /** Receiver wallet UUID — validated to exist before payment is created. */
  @IsString()
  @IsNotEmpty()
  receiverWalletId: string;

  @IsNumber()
  @IsPositive()
  amount: number;

  @IsString()
  @IsNotEmpty()
  currency: string;

  @IsString()
  @IsOptional()
  description?: string;

  /** Legacy sender ID (LegacyUser.id) — required for payment record FK. */
  @IsInt()
  fromId: number;

  /** Legacy receiver ID (LegacyUser.id) — required for payment record FK. */
  @IsInt()
  toId: number;

  /**
   * #972 — Developer that owns this payment.
   * Scopes the payment to a developer's namespace so that cross-developer
   * enumeration and mutation are impossible. Required for new payments when
   * PAYMENT_ISOLATION_ENABLED=true (default); optional during migration period.
   */
  @IsString()
  @IsOptional()
  developerOwnerId?: string;

  /**
   * #972 — Client-supplied idempotency key (max 128 chars, UUID recommended).
   * If a payment with this key already exists, the cached payment is returned
   * without re-executing any side effects (idempotent POST).
   * The uniqueness constraint is enforced at the database level.
   */
  @IsString()
  @IsOptional()
  @MaxLength(128)
  idempotencyKey?: string;
}
