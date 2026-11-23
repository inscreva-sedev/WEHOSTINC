import mongoose from 'mongoose';

export interface IPortfolioProject {
  id: string;
  name: string;
  domain: string;
  url?: string;
  linkDisabled: boolean;
  categoryPt: string;
  categoryEn: string;
  descriptionPt: string;
  descriptionEn: string;
  image: string;
  quoteHref: string;
  order: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

const PortfolioProjectSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    domain: { type: String, default: '' },
    url: { type: String, default: '' },
    linkDisabled: { type: Boolean, default: false },
    categoryPt: { type: String, required: true },
    categoryEn: { type: String, default: '' },
    descriptionPt: { type: String, required: true },
    descriptionEn: { type: String, default: '' },
    image: { type: String, required: true },
    quoteHref: { type: String, default: '/site-quote' },
    order: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
    createdAt: { type: String, required: true },
    updatedAt: { type: String, required: true },
  },
  { collection: 'portfolio_projects' }
);

const PortfolioProjectModel =
  mongoose.models.PortfolioProject ||
  mongoose.model('PortfolioProject', PortfolioProjectSchema);

export default PortfolioProjectModel;
