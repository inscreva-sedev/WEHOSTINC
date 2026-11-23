'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  Plus, Edit, Trash2, ExternalLink, Image as ImageIcon, Save, X,
  Loader2, ArrowLeft, ChevronUp, ChevronDown, Eye, EyeOff, Link2,
  Unlink, Layers, Upload
} from 'lucide-react';
import { PortfolioProject } from '@/lib/portfolioData';
import BrandLogo from '@/components/BrandLogo';
import PageLoader from '@/components/PageLoader';
import ConfirmModal from '@/components/ConfirmModal';
import Toast from '@/components/Toast';

interface PortfolioFormState {
  name: string;
  domain: string;
  url: string;
  linkDisabled: boolean;
  categoryPt: string;
  categoryEn: string;
  descriptionPt: string;
  descriptionEn: string;
  image: string;
  quoteHref: string;
  active: boolean;
}

const emptyForm: PortfolioFormState = {
  name: '',
  domain: '',
  url: '',
  linkDisabled: false,
  categoryPt: '',
  categoryEn: '',
  descriptionPt: '',
  descriptionEn: '',
  image: '',
  quoteHref: '/site-quote',
  active: true,
};

export default function AdminPortfolioPage() {
  const [projects, setProjects] = useState<PortfolioProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editingProject, setEditingProject] = useState<PortfolioProject | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PortfolioProject | null>(null);
  const [formData, setFormData] = useState<PortfolioFormState>(emptyForm);
  const [toast, setToast] = useState<{
    show: boolean;
    message: string;
    type: 'success' | 'error';
  }>({ show: false, message: '', type: 'success' });

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ show: true, message, type });
  }, []);

  const loadProjects = useCallback(async () => {
    try {
      const res = await fetch('/api/portfolio?all=1', { cache: 'no-store' });
      const data = await res.json();
      if (res.status === 401 || res.status === 403) {
        setAuthError(data.error || 'Acesso restrito a administradores.');
        return;
      }
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Erro ao carregar portfólio');
      }
      setProjects(data.projects || []);
      setAuthError(null);
    } catch (error: any) {
      console.error('[AdminPortfolio] Load error:', error);
      showToast(error?.message || 'Erro ao carregar projetos do portfólio', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const openModal = (project?: PortfolioProject) => {
    if (project) {
      setEditingProject(project);
      setFormData({
        name: project.name || '',
        domain: project.domain || '',
        url: project.url || '',
        linkDisabled: Boolean(project.linkDisabled),
        categoryPt: project.categoryPt || '',
        categoryEn: project.categoryEn || '',
        descriptionPt: project.descriptionPt || '',
        descriptionEn: project.descriptionEn || '',
        image: project.image || '',
        quoteHref: project.quoteHref || '/site-quote',
        active: project.active !== false,
      });
    } else {
      setEditingProject(null);
      setFormData(emptyForm);
    }
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingProject(null);
    setFormData(emptyForm);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      showToast('Selecione apenas ficheiros de imagem (JPG, PNG, WebP).', 'error');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      showToast('A imagem deve ter no máximo 10MB.', 'error');
      return;
    }

    setUploading(true);
    try {
      const uploadBody = new FormData();
      uploadBody.append('file', file);

      const res = await fetch('/api/upload', {
        method: 'POST',
        body: uploadBody,
      });
      const data = await res.json();

      if (!res.ok || !data?.url) {
        throw new Error(data?.error || 'Falha ao enviar imagem');
      }

      setFormData((prev) => ({ ...prev, image: data.url }));
      showToast('Imagem enviada com sucesso!');
    } catch (err: any) {
      showToast(err?.message || 'Erro ao fazer upload da imagem', 'error');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleSave = async () => {
    if (
      !formData.name.trim() ||
      !formData.categoryPt.trim() ||
      !formData.descriptionPt.trim() ||
      !formData.image.trim()
    ) {
      showToast('Preencha nome, categoria, descrição e imagem.', 'error');
      return;
    }

    setSaving(true);
    try {
      const isEdit = Boolean(editingProject);
      const res = await fetch('/api/portfolio', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          isEdit ? { id: editingProject!.id, ...formData } : formData
        ),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data?.error || 'Erro ao guardar projeto');
      }

      setProjects(data.projects || []);
      showToast(isEdit ? 'Projeto atualizado com sucesso!' : 'Projeto adicionado ao portfólio!');
      closeModal();
    } catch (err: any) {
      showToast(err?.message || 'Erro ao guardar projeto', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleQuickPatch = async (project: PortfolioProject, patch: Partial<PortfolioProject>, msg: string) => {
    try {
      const res = await fetch('/api/portfolio', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: project.id, ...patch }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data?.error || 'Erro ao atualizar projeto');
      }
      setProjects(data.projects || []);
      showToast(msg);
    } catch (err: any) {
      showToast(err?.message || 'Erro ao atualizar projeto', 'error');
    }
  };

  const handleMove = async (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= projects.length) return;

    const reordered = [...projects];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(targetIndex, 0, moved);
    setProjects(reordered);

    try {
      const res = await fetch('/api/portfolio', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reorder',
          orderedIds: reordered.map((p) => p.id),
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setProjects(data.projects || reordered);
        showToast('Ordem atualizada!');
      } else {
        throw new Error(data?.error || 'Erro ao reordenar');
      }
    } catch (err: any) {
      showToast(err?.message || 'Erro ao guardar ordem', 'error');
      loadProjects();
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      const res = await fetch(`/api/portfolio?id=${encodeURIComponent(deleteTarget.id)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data?.error || 'Erro ao eliminar projeto');
      }
      setProjects(data.projects || []);
      showToast('Projeto removido do portfólio.');
    } catch (err: any) {
      showToast(err?.message || 'Erro ao eliminar projeto', 'error');
    } finally {
      setDeleteTarget(null);
    }
  };

  if (loading) {
    return <PageLoader text="A carregar gestão de portfólio..." />;
  }

  if (authError) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl border border-gray-200 shadow-lg max-w-md w-full p-8 text-center">
          <Layers className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-gray-900 mb-2">Acesso Restrito</h1>
          <p className="text-sm text-gray-600 mb-6">{authError}</p>
          <Link
            href="/login"
            className="inline-flex items-center justify-center px-6 py-2.5 bg-primary-600 hover:bg-primary-700 text-white font-semibold text-sm rounded-xl transition"
          >
            Iniciar Sessão como Admin
          </Link>
        </div>
      </div>
    );
  }

  const activeCount = projects.filter((p) => p.active !== false).length;
  const disabledLinksCount = projects.filter((p) => p.linkDisabled || !p.url).length;

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 shadow-sm sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap justify-between items-center gap-3 py-4">
            <div className="flex items-center space-x-3 sm:space-x-4">
              <BrandLogo />
              <div className="h-6 w-px bg-gray-200" />
              <h1 className="text-base sm:text-xl font-bold text-gray-900 flex items-center gap-2">
                <span>Gestão de Portfólio</span>
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 font-semibold border border-blue-200">
                  Home &amp; Criar Site
                </span>
              </h1>
            </div>
            <div className="flex items-center gap-2 sm:gap-3">
              <Link
                href="/#portfolio"
                target="_blank"
                className="flex items-center space-x-1.5 px-3 py-2 text-xs sm:text-sm font-medium text-primary-700 bg-primary-50 hover:bg-primary-100 rounded-xl transition"
              >
                <ExternalLink className="h-4 w-4" />
                <span>Ver no Site</span>
              </Link>
              <Link
                href="/admin"
                className="flex items-center space-x-1.5 px-3 py-2 text-xs sm:text-sm font-medium text-gray-700 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 rounded-xl transition"
              >
                <ArrowLeft className="h-4 w-4" />
                <span>Voltar ao Painel</span>
              </Link>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Top Action Card */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8 bg-white p-6 rounded-2xl border border-gray-200/80 shadow-xs">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Projetos em Destaque</h2>
            <p className="text-xs sm:text-sm text-gray-500 mt-1">
              Adicione, edite, reordene ou desative links de sites fora do ar sem mexer em código.
            </p>
            <div className="flex flex-wrap gap-2 mt-3">
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-100 text-slate-700">
                Total: {projects.length}
              </span>
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                Visíveis: {activeCount}
              </span>
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                Links Desativados: {disabledLinksCount}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => openModal()}
            className="flex items-center space-x-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white px-4 py-2.5 rounded-xl font-semibold text-xs sm:text-sm shadow-sm hover:shadow transition cursor-pointer shrink-0"
          >
            <Plus className="h-4 w-4" />
            <span>Adicionar Projeto</span>
          </button>
        </div>

        {/* Projects Grid */}
        {projects.length === 0 ? (
          <div className="bg-white rounded-2xl border border-dashed border-gray-300 p-12 text-center">
            <Layers className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <h3 className="text-base font-bold text-gray-900 mb-1">Nenhum projeto no portfólio</h3>
            <p className="text-sm text-gray-500 mb-5">Adicione o primeiro projeto para exibi-lo na página inicial.</p>
            <button
              type="button"
              onClick={() => openModal()}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary-600 hover:bg-primary-700 text-white font-semibold text-sm rounded-xl transition cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Adicionar Projeto</span>
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {projects.map((project, index) => {
              const isVisible = project.active !== false;
              const isLinkOff = Boolean(project.linkDisabled) || !project.url;

              return (
                <div
                  key={project.id}
                  className={`bg-white rounded-2xl border overflow-hidden shadow-xs flex flex-col justify-between transition ${
                    isVisible ? 'border-gray-200/90' : 'border-gray-200 bg-gray-50/70 opacity-75'
                  }`}
                >
                  <div>
                    {/* Preview */}
                    <div className="relative h-48 bg-slate-900 overflow-hidden">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={project.image}
                        alt={project.name}
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-transparent to-black/80" />
                      <div className="absolute top-3 left-3 right-3 flex items-center justify-between gap-2">
                        <span className="text-[11px] font-semibold text-white bg-black/40 backdrop-blur-sm px-2.5 py-1 rounded-full">
                          {project.categoryPt}
                        </span>
                        <span
                          className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${
                            isVisible
                              ? 'bg-emerald-500/90 text-white'
                              : 'bg-slate-700/90 text-slate-200'
                          }`}
                        >
                          {isVisible ? 'Visível' : 'Oculto'}
                        </span>
                      </div>
                      <div className="absolute bottom-3 left-3 right-3">
                        <h3 className="text-lg font-extrabold text-white truncate">{project.name}</h3>
                        <p className="text-xs text-white/80 truncate">
                          {project.domain || project.url || 'Sem domínio definido'}
                        </p>
                      </div>
                    </div>

                    {/* Details */}
                    <div className="p-4">
                      <p className="text-xs text-gray-600 line-clamp-2 min-h-[32px]">
                        {project.descriptionPt}
                      </p>

                      {/* 1-click Toggles */}
                      <div className="flex flex-wrap gap-2 mt-4">
                        <button
                          type="button"
                          onClick={() =>
                            handleQuickPatch(
                              project,
                              { linkDisabled: !project.linkDisabled },
                              !project.linkDisabled
                                ? `Link de ${project.name} desativado`
                                : `Link de ${project.name} reativado`
                            )
                          }
                          className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition cursor-pointer ${
                            isLinkOff
                              ? 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100'
                              : 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100'
                          }`}
                          title="Ligar ou desligar o botão Visitar site"
                        >
                          {isLinkOff ? <Unlink className="w-3.5 h-3.5" /> : <Link2 className="w-3.5 h-3.5" />}
                          <span>{isLinkOff ? 'Link Desativado' : 'Link Ativo'}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            handleQuickPatch(
                              project,
                              { active: !isVisible },
                              isVisible
                                ? `${project.name} ocultado do site`
                                : `${project.name} visível no site`
                            )
                          }
                          className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition cursor-pointer ${
                            isVisible
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                              : 'bg-gray-100 text-gray-600 border-gray-200 hover:bg-gray-200'
                          }`}
                        >
                          {isVisible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                          <span>{isVisible ? 'Visível' : 'Oculto'}</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Footer Actions */}
                  <div className="px-4 py-3 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleMove(index, -1)}
                        disabled={index === 0}
                        className="p-1.5 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-200/70 disabled:opacity-30 disabled:pointer-events-none transition cursor-pointer"
                        title="Mover para trás"
                      >
                        <ChevronUp className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMove(index, 1)}
                        disabled={index === projects.length - 1}
                        className="p-1.5 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-200/70 disabled:opacity-30 disabled:pointer-events-none transition cursor-pointer"
                        title="Mover para frente"
                      >
                        <ChevronDown className="w-4 h-4" />
                      </button>
                      <span className="text-[11px] font-bold text-gray-400 ml-1">#{index + 1}</span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      {project.url && !isLinkOff && (
                        <a
                          href={project.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-2 rounded-lg text-gray-500 hover:text-primary-600 hover:bg-primary-50 transition"
                          title="Abrir site"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => openModal(project)}
                        className="p-2 rounded-lg text-gray-600 hover:text-blue-600 hover:bg-blue-50 transition cursor-pointer"
                        title="Editar projeto"
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(project)}
                        className="p-2 rounded-lg text-gray-500 hover:text-red-600 hover:bg-red-50 transition cursor-pointer"
                        title="Eliminar projeto"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Modal Criar / Editar */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs">
          <div className="bg-white rounded-3xl shadow-2xl border border-gray-100 max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between pb-4 border-b border-gray-100 mb-5">
              <h2 className="text-lg font-bold text-gray-900">
                {editingProject ? `Editar: ${editingProject.name}` : 'Novo Projeto no Portfólio'}
              </h2>
              <button
                type="button"
                onClick={closeModal}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">
                    Nome do Projeto *
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))}
                    placeholder="Ex: Prime Auction"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 text-sm focus:ring-2 focus:ring-primary-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">
                    Domínio (exibido no card)
                  </label>
                  <input
                    type="text"
                    value={formData.domain}
                    onChange={(e) => setFormData((p) => ({ ...p, domain: e.target.value }))}
                    placeholder="Ex: primeauction.co.mz"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 text-sm focus:ring-2 focus:ring-primary-500 outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">
                    Categoria (Português) *
                  </label>
                  <input
                    type="text"
                    value={formData.categoryPt}
                    onChange={(e) => setFormData((p) => ({ ...p, categoryPt: e.target.value }))}
                    placeholder="Ex: Plataforma de Leilões"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 text-sm focus:ring-2 focus:ring-primary-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">
                    Categoria (Inglês - opcional)
                  </label>
                  <input
                    type="text"
                    value={formData.categoryEn}
                    onChange={(e) => setFormData((p) => ({ ...p, categoryEn: e.target.value }))}
                    placeholder="Ex: Online Auction Platform"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 text-sm focus:ring-2 focus:ring-primary-500 outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  URL do Site
                </label>
                <input
                  type="url"
                  value={formData.url}
                  onChange={(e) => setFormData((p) => ({ ...p, url: e.target.value }))}
                  placeholder="https://primeauction.co.mz"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 text-sm focus:ring-2 focus:ring-primary-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  Descrição Curta (Português) *
                </label>
                <textarea
                  rows={2}
                  value={formData.descriptionPt}
                  onChange={(e) => setFormData((p) => ({ ...p, descriptionPt: e.target.value }))}
                  placeholder="Descreva brevemente o projeto em 1-2 linhas..."
                  className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 text-sm focus:ring-2 focus:ring-primary-500 outline-none resize-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  Descrição Curta (Inglês - opcional)
                </label>
                <textarea
                  rows={2}
                  value={formData.descriptionEn}
                  onChange={(e) => setFormData((p) => ({ ...p, descriptionEn: e.target.value }))}
                  placeholder="Short description in English..."
                  className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 text-sm focus:ring-2 focus:ring-primary-500 outline-none resize-none"
                />
              </div>

              {/* Imagem */}
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  Imagem de Capa *
                </label>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={formData.image}
                    onChange={(e) => setFormData((p) => ({ ...p, image: e.target.value }))}
                    placeholder="/portfolio/exemplo.jpg ou URL Cloudinary"
                    className="flex-1 px-3.5 py-2.5 rounded-xl border border-gray-200 text-sm focus:ring-2 focus:ring-primary-500 outline-none"
                  />
                  <label className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold text-xs rounded-xl cursor-pointer transition shrink-0">
                    {uploading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>A enviar...</span>
                      </>
                    ) : (
                      <>
                        <Upload className="w-4 h-4" />
                        <span>Carregar Foto</span>
                      </>
                    )}
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleImageUpload}
                      disabled={uploading}
                      className="hidden"
                    />
                  </label>
                </div>
                {formData.image && (
                  <div className="mt-3 relative h-36 rounded-xl overflow-hidden bg-slate-900 border border-gray-200">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={formData.image}
                      alt="Pré-visualização"
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}
              </div>

              {/* Switches */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                <label className="flex items-start gap-3 p-3 rounded-xl border border-gray-200 bg-gray-50/70 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.linkDisabled}
                    onChange={(e) => setFormData((p) => ({ ...p, linkDisabled: e.target.checked }))}
                    className="mt-0.5 h-4 w-4 rounded text-primary-600"
                  />
                  <div>
                    <span className="text-xs font-bold text-gray-900 block">
                      Desativar link externo
                    </span>
                    <span className="text-[11px] text-gray-500">
                      Oculta &quot;Visitar site&quot; caso o site esteja fora do ar.
                    </span>
                  </div>
                </label>

                <label className="flex items-start gap-3 p-3 rounded-xl border border-gray-200 bg-gray-50/70 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.active}
                    onChange={(e) => setFormData((p) => ({ ...p, active: e.target.checked }))}
                    className="mt-0.5 h-4 w-4 rounded text-primary-600"
                  />
                  <div>
                    <span className="text-xs font-bold text-gray-900 block">
                      Visível no site
                    </span>
                    <span className="text-[11px] text-gray-500">
                      Desmarque para ocultar temporariamente sem apagar.
                    </span>
                  </div>
                </label>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-gray-100">
              <button
                type="button"
                onClick={closeModal}
                className="px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-100 rounded-xl transition cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || uploading}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary-600 hover:bg-primary-700 disabled:opacity-60 text-white text-sm font-bold rounded-xl shadow transition cursor-pointer"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                <span>{saving ? 'A guardar...' : 'Guardar Projeto'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Confirmação Eliminar */}
      <ConfirmModal
        isOpen={Boolean(deleteTarget)}
        title="Eliminar projeto do portfólio"
        message={`Tem a certeza que deseja eliminar "${deleteTarget?.name || ''}" do portfólio?`}
        confirmText="Eliminar"
        cancelText="Cancelar"
        variant="danger"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      {toast.show && (
        <Toast
          type={toast.type}
          message={toast.message}
          onClose={() => setToast((t) => ({ ...t, show: false }))}
        />
      )}
    </div>
  );
}
