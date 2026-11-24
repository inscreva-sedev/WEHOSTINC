'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ChevronLeft, ChevronRight, ExternalLink, Layers } from 'lucide-react';
import { portfolioProjects, PortfolioProject } from '@/lib/portfolioData';
import { useLanguage } from '@/context/LanguageContext';
import ScrollRevealHeading from '@/components/ScrollRevealHeading';

interface PortfolioSectionProps {
  id?: string;
  className?: string;
}

export default function PortfolioSection({ id = 'portfolio', className = '' }: PortfolioSectionProps) {
  const { language } = useLanguage();
  const isEn = language === 'en';
  const trackRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLElement | null)[]>([]);
  const [projects, setProjects] = useState<PortfolioProject[]>(portfolioProjects);
  const [hasLoadedFromApi, setHasLoadedFromApi] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);

  useEffect(() => {
    let active = true;
    const loadPortfolio = async () => {
      try {
        const res = await fetch('/api/portfolio', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (active && data?.success && Array.isArray(data.projects)) {
          setProjects(data.projects);
          setHasLoadedFromApi(true);
        }
      } catch {
        // Mantém fallback estático se a API estiver indisponível
      }
    };
    loadPortfolio();
    return () => {
      active = false;
    };
  }, []);

  const updateScrollState = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;

    const { scrollLeft, scrollWidth, clientWidth } = track;
    setCanScrollLeft(scrollLeft > 16);
    setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 16);

    // Determinar qual card está mais próximo do início visível do track
    const trackLeft = track.getBoundingClientRect().left;
    let closestIdx = 0;
    let closestDist = Infinity;

    cardRefs.current.forEach((card, idx) => {
      if (!card) return;
      const dist = Math.abs(card.getBoundingClientRect().left - trackLeft);
      if (dist < closestDist) {
        closestDist = dist;
        closestIdx = idx;
      }
    });

    setActiveIndex(closestIdx);
  }, []);

  useEffect(() => {
    updateScrollState();
    window.addEventListener('resize', updateScrollState);
    return () => window.removeEventListener('resize', updateScrollState);
  }, [updateScrollState, projects.length]);

  const scrollToIndex = (index: number) => {
    if (projects.length === 0) return;
    const clamped = Math.max(0, Math.min(projects.length - 1, index));
    const track = trackRef.current;
    const card = cardRefs.current[clamped];
    if (!track || !card) return;

    const targetLeft = card.offsetLeft - track.offsetLeft;
    track.scrollTo({ left: targetLeft, behavior: 'smooth' });
    setActiveIndex(clamped);
  };

  const handlePrev = () => {
    if (projects.length === 0) return;
    scrollToIndex(activeIndex > 0 ? activeIndex - 1 : projects.length - 1);
  };

  const handleNext = () => {
    if (projects.length === 0) return;
    scrollToIndex(activeIndex < projects.length - 1 ? activeIndex + 1 : 0);
  };

  if (hasLoadedFromApi && projects.length === 0) {
    return null;
  }

  return (
    <section
      id={id}
      className={`py-10 sm:py-16 px-3 sm:px-6 bg-gradient-to-b from-white via-slate-50/70 to-white dark:from-slate-950 dark:via-slate-900/80 dark:to-slate-950 overflow-hidden ${className}`}
    >
      <div className="max-w-7xl mx-auto">
        {/* Cabeçalho */}
        <div className="mb-6 sm:mb-10">
          <ScrollRevealHeading
            badge={isEn ? 'Portfolio' : 'Portfólio'}
            badgeIcon={<Layers className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-primary-600 dark:text-primary-400" />}
            badgeClassName="bg-primary-50 dark:bg-primary-950/60 text-primary-800 dark:text-primary-300 border border-primary-200 dark:border-primary-800"
            text={isEn ? 'Projects We Have Built' : 'Trabalhos que Já Desenvolvemos'}
            subtitle={
              isEn
                ? 'Explore live websites and digital platforms created by WEHOSTHERE for brands and businesses.'
                : 'Deslize para explorar sites e plataformas reais criados pela WEHOSTHERE. Clique para visitar cada projeto ao vivo.'
            }
            align="center"
            showAccentLine={true}
            titleClassName="text-xl sm:text-2xl lg:text-3xl font-extrabold text-gray-900 dark:text-slate-100"
            subtitleClassName="text-xs sm:text-base text-gray-600 dark:text-slate-400 max-w-2xl mx-auto px-2"
            highlightWords={['Desenvolvemos', 'Built']}
          />
        </div>

        {/* Carrossel horizontal estilo Tesla */}
        <div className="relative group/carousel">
          {/* Setas flutuantes */}
          <button
            type="button"
            onClick={handlePrev}
            aria-label={isEn ? 'Previous project' : 'Projeto anterior'}
            className={`hidden sm:flex items-center justify-center absolute left-3 top-1/2 -translate-y-1/2 z-20 w-10 h-10 rounded-lg bg-white/90 hover:bg-white dark:bg-slate-900/90 dark:hover:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-lg border border-slate-200/70 dark:border-slate-700 backdrop-blur-sm transition-all duration-200 hover:scale-105 active:scale-95 ${
              canScrollLeft ? 'opacity-95' : 'opacity-40 hover:opacity-90'
            }`}
          >
            <ChevronLeft className="w-5 h-5" />
          </button>

          <button
            type="button"
            onClick={handleNext}
            aria-label={isEn ? 'Next project' : 'Próximo projeto'}
            className={`hidden sm:flex items-center justify-center absolute right-3 top-1/2 -translate-y-1/2 z-20 w-10 h-10 rounded-lg bg-white/90 hover:bg-white dark:bg-slate-900/90 dark:hover:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-lg border border-slate-200/70 dark:border-slate-700 backdrop-blur-sm transition-all duration-200 hover:scale-105 active:scale-95 ${
              canScrollRight ? 'opacity-95' : 'opacity-40 hover:opacity-90'
            }`}
          >
            <ChevronRight className="w-5 h-5" />
          </button>

          {/* Trilha de scroll horizontal com snap */}
          <div
            ref={trackRef}
            onScroll={updateScrollState}
            className="flex gap-4 sm:gap-6 overflow-x-auto snap-x snap-mandatory scroll-smooth pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {projects.map((project, index) => (
              <article
                key={project.id}
                ref={(el) => {
                  cardRefs.current[index] = el;
                }}
                className="group relative snap-start shrink-0 w-[86%] sm:w-[74%] lg:w-[66%] xl:w-[62%] h-[360px] sm:h-[430px] lg:h-[470px] rounded-xl sm:rounded-2xl overflow-hidden bg-slate-900 shadow-xl border border-slate-200/60 dark:border-slate-800 select-none"
              >
                {/* Imagem de fundo */}
                <Image
                  src={project.image}
                  alt={`${project.name} - ${isEn ? project.categoryEn : project.categoryPt}`}
                  fill
                  sizes="(max-width: 640px) 86vw, (max-width: 1024px) 74vw, 62vw"
                  className="object-cover object-center transition-transform duration-700 ease-out group-hover:scale-105"
                />

                {/* Degradê sutil para legibilidade (topo e base) */}
                <div className="absolute inset-0 bg-gradient-to-b from-slate-950/60 via-slate-950/15 to-slate-950/90" />

                {/* Topo: Categoria à esquerda + Domínio à direita (oculto se linkDisabled) */}
                <div className="absolute top-4 sm:top-6 left-4 sm:left-7 right-4 sm:right-7 flex items-center justify-between gap-2 z-10">
                  <span className="text-xs sm:text-sm font-semibold text-white/95 tracking-wide drop-shadow">
                    {isEn ? project.categoryEn : project.categoryPt}
                  </span>
                  {!project.linkDisabled && project.domain && (
                    <span className="text-[10px] sm:text-xs font-medium text-white/90 bg-white/15 backdrop-blur-md px-2.5 sm:px-3 py-1 rounded-full border border-white/20 truncate max-w-[180px] sm:max-w-none">
                      {project.domain}
                    </span>
                  )}
                </div>

                {/* Base: Título, descrição curta e 2 botões estilo Tesla */}
                <div className="absolute bottom-5 sm:bottom-8 left-4 sm:left-8 right-4 sm:right-8 z-10">
                  <h3 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight mb-1 sm:mb-1.5 drop-shadow">
                    {project.name}
                  </h3>
                  <p className="text-xs sm:text-base text-white/85 mb-4 sm:mb-5 max-w-xl line-clamp-2 leading-relaxed">
                    {isEn ? project.descriptionEn : project.descriptionPt}
                  </p>

                  <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
                    {!project.linkDisabled && project.url ? (
                      <>
                        <a
                          href={project.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center justify-center gap-2 bg-primary-600 hover:bg-primary-700 text-white font-bold text-xs sm:text-sm px-5 sm:px-7 py-2.5 sm:py-3 rounded-lg shadow-lg transition-all duration-200 hover:scale-[1.02] active:scale-95"
                        >
                          <span>{isEn ? 'Visit site' : 'Visitar site'}</span>
                          <ExternalLink className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                        </a>

                        <Link
                          href={project.quoteHref}
                          className="preserve-light inline-flex items-center justify-center bg-white hover:bg-slate-100 dark:bg-white dark:hover:bg-slate-100 text-slate-900 dark:text-slate-900 font-bold text-xs sm:text-sm px-5 sm:px-7 py-2.5 sm:py-3 rounded-lg shadow-lg transition-all duration-200 hover:scale-[1.02] active:scale-95"
                        >
                          {isEn ? 'Request similar' : 'Quero um igual'}
                        </Link>
                      </>
                    ) : (
                      <Link
                        href={project.quoteHref}
                        className="inline-flex items-center justify-center bg-primary-600 hover:bg-primary-700 text-white font-bold text-xs sm:text-sm px-5 sm:px-7 py-2.5 sm:py-3 rounded-lg shadow-lg transition-all duration-200 hover:scale-[1.02] active:scale-95"
                      >
                        {isEn ? 'Request similar' : 'Quero um igual'}
                      </Link>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>

        {/* Bolinhas de paginação sincronizadas */}
        <div className="flex items-center justify-center gap-2 mt-5 sm:mt-6">
          {projects.map((project, index) => (
            <button
              key={project.id}
              type="button"
              onClick={() => scrollToIndex(index)}
              aria-label={`${isEn ? 'Go to project' : 'Ver projeto'} ${project.name}`}
              className={`h-2.5 rounded-full transition-all duration-300 cursor-pointer ${
                activeIndex === index
                  ? 'w-6 bg-slate-900 dark:bg-primary-400'
                  : 'w-2.5 bg-slate-300 hover:bg-slate-400 dark:bg-slate-700 dark:hover:bg-slate-600'
              }`}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
