export interface PortfolioProject {
  id: string;
  name: string;
  domain: string;
  url?: string;
  /** Define como true caso o site do cliente esteja offline/em manutenção para ocultar o botão de visita */
  linkDisabled?: boolean;
  categoryPt: string;
  categoryEn: string;
  descriptionPt: string;
  descriptionEn: string;
  image: string;
  quoteHref: string;
  order?: number;
  active?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export const portfolioProjects: PortfolioProject[] = [
  {
    id: 'prime-auction',
    name: 'Prime Auction',
    domain: 'primeauction.co.mz',
    url: 'https://primeauction.co.mz',
    categoryPt: 'Plataforma de Leilões',
    categoryEn: 'Online Auction Platform',
    descriptionPt: 'Plataforma digital de leilões online com catálogo dinâmico, lances em tempo real e gestão completa.',
    descriptionEn: 'Digital online auction platform with dynamic catalog, real-time bidding, and full management.',
    image: '/portfolio/primeauction.jpg',
    quoteHref: '/site-quote',
  },
  {
    id: 'prime-source',
    name: 'Prime Source',
    domain: 'primesource.co.mz',
    url: 'https://primesource.co.mz',
    categoryPt: 'Logística & Operações',
    categoryEn: 'Logistics & Operations',
    descriptionPt: 'Presença digital corporativa para empresa de logística, transporte de cargas e soluções empresariais.',
    descriptionEn: 'Corporate digital presence for a logistics, freight transport, and business solutions company.',
    image: '/portfolio/primesource.jpg',
    quoteHref: '/site-quote',
  },
  {
    id: 'rpa-mocambique',
    name: 'RPA Moçambique',
    domain: 'recuperaaqui.vercel.app',
    url: 'https://recuperaaqui.vercel.app/',
    categoryPt: 'Recuperação de Documentos',
    categoryEn: 'Document Recovery Platform',
    descriptionPt: 'Plataforma de apoio cívico para registo, pesquisa e recuperação rápida de documentos perdidos em Moçambique.',
    descriptionEn: 'Civic support platform for registering, searching, and quickly recovering lost documents in Mozambique.',
    image: '/portfolio/recuperaaqui.jpg',
    quoteHref: '/site-quote',
  },
  {
    id: 'blvrs-media',
    name: 'Blvrs Media',
    domain: 'blvrsmedia.vercel.app',
    url: 'https://blvrsmedia.vercel.app/',
    categoryPt: 'Agência & Publicidade',
    categoryEn: 'Brand & Advertising Agency',
    descriptionPt: 'Website institucional criativo para agência especializada em gestão de marcas, marketing e publicidade.',
    descriptionEn: 'Creative agency website specialized in brand management, digital marketing, and advertising.',
    image: '/portfolio/blvrsmedia.jpg',
    quoteHref: '/site-quote',
  },
  {
    id: 'inscreva-se',
    name: 'Inscreva-se',
    domain: 'inscreva-se.com',
    url: 'https://inscreva-se.com/',
    categoryPt: 'Gestão de Eventos',
    categoryEn: 'Event Management Platform',
    descriptionPt: 'Plataforma completa para criação de eventos, venda de bilhetes e gestão de inscrições online.',
    descriptionEn: 'Complete platform for event creation, ticketing, and online registration management.',
    image: '/portfolio/inscreva-se.jpg',
    quoteHref: '/site-quote',
  },
  {
    id: 'muv',
    name: 'MUV Educação & Engenharia',
    domain: 'muv.co.mz',
    url: 'https://www.muv.co.mz/',
    categoryPt: 'Educação & Engenharia',
    categoryEn: 'Education & Engineering',
    descriptionPt: 'Portal institucional e plataforma de formação técnico-profissional e consultoria em engenharia em Moçambique.',
    descriptionEn: 'Institutional portal and platform for technical-vocational training and engineering consulting in Mozambique.',
    image: '/portfolio/muv.jpg',
    quoteHref: '/site-quote',
  },
];
