import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IOrder extends Document {
  id: string;
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  serviceName: string;
  amount: number;
  currency?: string;
  valorFaturado?: number;
  valorPorFaturar?: number;
  paymentMethod: 'mpesa' | 'emola' | 'card' | 'vpay' | 'bank_transfer';
  kivoraPaymentId?: string; // ID do pagamento na Kivora (pay_xxxxx) para reconciliação
  vpayOrderId?: string; // ID da ordem na VPay
  vpayTransactionId?: string; // ID da transação confirmada na VPay
  vpayDeliveryId?: string; // X-Voidpay-Delivery processado na confirmação
  vpayCheckoutUrl?: string; // URL de checkout retornada pela VPay
  reference?: string; // Referência da transação/checkout (REF_xxxxx)
  proofUrl?: string;
  proofName?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled' | 'suspended';
  cartRecoverySent?: boolean;
  paidAt?: string;
  metadata?: Record<string, any>;
  createdAt: string;
}

const OrderSchema = new Schema<IOrder>({
  id: { type: String, required: true, unique: true },
  clientName: { type: String, required: true },
  clientEmail: { type: String, required: true, lowercase: true, trim: true },
  clientPhone: { type: String, default: '' },
  serviceName: { type: String, required: true },
  amount: { type: Number, required: true },
  currency: { type: String, default: 'MZN', uppercase: true, trim: true },
  valorFaturado: { type: Number },
  valorPorFaturar: { type: Number },
  paymentMethod: { type: String, enum: ['mpesa', 'emola', 'card', 'vpay', 'bank_transfer'], default: 'bank_transfer' },
  kivoraPaymentId: { type: String }, // ID do pagamento na Kivora para reconciliação
  vpayOrderId: { type: String },
  vpayTransactionId: { type: String },
  vpayDeliveryId: { type: String },
  vpayCheckoutUrl: { type: String },
  reference: { type: String }, // Referência da transação/checkout (REF_xxxxx)
  proofUrl: { type: String },
  proofName: { type: String },
  status: { type: String, enum: ['pending', 'in_progress', 'completed', 'cancelled', 'suspended'], default: 'pending' },
  cartRecoverySent: { type: Boolean, default: false },
  paidAt: { type: String },
  metadata: { type: Schema.Types.Mixed },
  createdAt: { type: String, default: () => new Date().toISOString() },
}, { timestamps: false, versionKey: false, strict: false });

OrderSchema.index({ vpayOrderId: 1 }, { sparse: true });
OrderSchema.index({ reference: 1 }, { sparse: true });

const OrderModel: Model<IOrder> = mongoose.models.Order || mongoose.model<IOrder>('Order', OrderSchema);
export default OrderModel;
