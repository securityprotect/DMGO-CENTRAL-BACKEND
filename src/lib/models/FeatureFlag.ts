import mongoose, { InferSchemaType, Model, Schema } from 'mongoose';

const featureFlagSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    description: { type: String, default: '' },
    enabled: { type: Boolean, default: false, index: true },
    rolloutPercent: { type: Number, default: 0 },
    updatedBy: { type: String, default: 'system' },
  },
  { timestamps: true }
);

export type FeatureFlagDoc = InferSchemaType<typeof featureFlagSchema> & { _id: string };

export const FeatureFlag: Model<FeatureFlagDoc> =
  mongoose.models.FeatureFlag || mongoose.model<FeatureFlagDoc>('FeatureFlag', featureFlagSchema);
