import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { Menu, User, Bell, ChevronDown, X, LogOut, Moon, Sun, BellRing, LogIn, Shield, PenLine } from 'lucide-react';
import { User as FirebaseUser } from '../firebase';
import type { AuthProfileSnapshot } from '../utils/authProfileCache';
import { payloadToHash } from '../utils/appHistory';
import { useSignInModal } from './SignInModalProvider';

/** Let Ctrl/Cmd/middle-click etc. use the browser; plain primary click uses SPA `onNavigate`. */
function skipModifiedNavClick(e: React.MouseEvent): boolean {
  return e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;
}

const NAV_HOME_HREF = payloadToHash({ v: 1, view: 'home' });
const NAV_CATALOG_HREF = payloadToHash({ v: 1, view: 'catalog' });
const NAV_CONTACT_HREF = payloadToHash({ v: 1, view: 'contact' });

function catalogLearningPathHref(pathId: string): string {
  return payloadToHash({ v: 1, view: 'catalog', learningPathId: pathId });
}

export interface NavbarNotification {
  id: string;
  message: string;
  read: boolean;
  time: string;
  kind?: 'certificate' | 'broadcast' | 'generic';
  actionView?: 'home' | 'catalog' | 'contact' | 'profile' | 'admin';
  adminTab?: 'alerts' | 'ai' | 'catalog' | 'marketing' | 'moderation' | 'roles';
  /** When opening Admin → Moderation, which inbox sub-tab to show. */
  adminModerationSubTab?: 'reports' | 'suggestions' | 'contact';
  actionLabel?: string;
  courseId?: string;
  lessonId?: string;
  moduleId?: string;
  alertId?: string;
}

const EMPTY_PRIVATE_PATH_IDS: ReadonlySet<string> = new Set();

type NavbarAccountUser = FirebaseUser | AuthProfileSnapshot;

function accountInitials(u: NavbarAccountUser): string {
  const d = u.displayName?.trim();
  if (d) {
    const parts = d.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      const a = parts[0]![0];
      const b = parts[1]![0];
      if (a && b) return (a + b).toUpperCase();
    }
    if (d.length >= 2) return d.slice(0, 2).toUpperCase();
    if (d.length === 1) return d.toUpperCase();
  }
  const em = u.email?.trim();
  if (em) {
    const local = em.split('@')[0] ?? '';
    if (local.length >= 2) return local.slice(0, 2).toUpperCase();
    if (local.length === 1) return local.toUpperCase();
  }
  if (u.uid.length >= 2) return u.uid.slice(0, 2).toUpperCase();
  return '?';
}

function accountMenuAriaLabel(u: NavbarAccountUser): string {
  const n = u.displayName?.trim();
  if (n) return `Account menu, ${n}`;
  const e = u.email?.trim();
  if (e) return `Account menu, ${e}`;
  return 'Account menu';
}

function NavProfileAvatar({ user }: { user: NavbarAccountUser }) {
  const [photoBroken, setPhotoBroken] = useState(false);
  useEffect(() => {
    setPhotoBroken(false);
  }, [user.uid, user.photoURL]);

  const url = user.photoURL?.trim();
  const tryPhoto = Boolean(url && !photoBroken);

  if (tryPhoto) {
    return (
      <span className="relative flex h-full w-full min-h-0 min-w-0 items-center justify-center overflow-hidden rounded-full bg-[var(--hover-bg)]">
        <img
          key={url}
          src={url}
          alt=""
          className="h-full w-full object-cover"
          referrerPolicy="no-referrer"
          loading="eager"
          fetchPriority="high"
          decoding="async"
          onError={() => setPhotoBroken(true)}
        />
      </span>
    );
  }

  return (
    <span className="flex h-full w-full min-h-0 min-w-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-brand-500 to-pink-500 text-white text-xs font-bold">
      <span
        className="select-none truncate px-0.5 text-[0.65rem] leading-none tracking-tight"
        aria-hidden
      >
        {accountInitials(user)}
      </span>
    </span>
  );
}

interface NavbarProps {
  onNavigate: (
    view: 'home' | 'catalog' | 'contact' | 'profile' | 'admin' | 'creator',
    clear?: boolean
  ) => void;
  activeView: string;
  /** Course Library filter control (catalog list only); replaces the old navbar search field. */
  catalogNavFilter?: React.ReactNode;
  onCategorySelect: (category: string) => void;
  /** Course Library category names (main pills + “More”), same order as filters; excludes “All”. */
  catalogBrowseCategories: readonly string[];
  /** Skill tags for Browse → Skills (presets + extras + from published courses). */
  catalogBrowseSkills: readonly string[];
  /** Active Course Library category filters (for menu/dropdown selected state and toggling). */
  catalogActiveCategoryTags?: readonly string[];
  /** Active Course Library skill filters. */
  catalogActiveSkillTags?: readonly string[];
  /** Catalog paths (published + creator drafts); same `id` may appear twice with different `fromCreatorDraft`. */
  learningPaths?: ReadonlyArray<{
    id: string;
    title: string;
    fromCreatorDraft?: boolean;
    adminPreviewOwnerUid?: string;
  }>;
  /** Path ids that have a creator draft doc (used when `fromCreatorDraft` is omitted on a row). */
  privatePathIds?: ReadonlySet<string>;
  /** Second arg: creator draft row; third: admin inventory preview owner uid when set. */
  onPathSelect: (pathId: string, fromCreatorDraft?: boolean, adminPreviewOwnerUid?: string) => void;
  /**
   * When set, catalog is scoped to a learning path (catalog hero, overview, or player with path context).
   * Highlights **Learning Paths** in the nav instead of **Browse Catalog**.
   */
  learningPathNavActive?: boolean;
  onSkillSelect: (skill: string) => void;
  theme: 'dark' | 'light';
  onThemeToggle: () => void;
  /** False until Firebase has reported initial auth state (avoids flashing "Login" when the user is already signed in). */
  isAuthReady: boolean;
  /** Firebase user or last-known profile from localStorage while auth restores (avatar only). */
  user: FirebaseUser | AuthProfileSnapshot | null;
  onLogout: () => void;
  notifications: NavbarNotification[];
  setNotifications: React.Dispatch<React.SetStateAction<NavbarNotification[]>>;
  /** Handle primary click on a notification (navigate, open profile, etc.). */
  onNotificationAction: (n: NavbarNotification) => void;
  /** Optional: persist dismiss (e.g. Firestore) before removing from the list. */
  onDismissNotification?: (n: NavbarNotification) => void;
  /** Called before clearing the list (e.g. stop re-adding Firestore-driven moderation rows until new activity). */
  onClearAllNotifications?: () => void;
  /** Signed-out: called before clearing the list when "Clear all" removes the welcome tip (avoids badge returning on refresh). */
  onGuestClearNotifications?: () => void;
  isAdmin?: boolean;
  /** Signed-in creator (or similar) — show Creator studio entry. */
  isCreator?: boolean;
  /** Hide fixed nav (e.g. full-bleed course player while video is playing). */
  immersiveHidden?: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  onNavigate,
  activeView,
  catalogNavFilter,
  onCategorySelect,
  catalogBrowseCategories,
  catalogBrowseSkills,
  catalogActiveCategoryTags = [],
  catalogActiveSkillTags = [],
  learningPaths = [],
  privatePathIds = EMPTY_PRIVATE_PATH_IDS,
  onPathSelect,
  learningPathNavActive = false,
  onSkillSelect,
  theme,
  onThemeToggle,
  isAuthReady,
  user,
  onLogout,
  notifications,
  setNotifications,
  onNotificationAction,
  onDismissNotification,
  onClearAllNotifications,
  onGuestClearNotifications,
  isAdmin = false,
  isCreator = false,
  immersiveHidden = false,
}) => {
  const { openSignInModal } = useSignInModal();
  const [openDropdown, setOpenDropdown] = useState<'paths' | 'skills' | 'profile' | 'notifications' | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileNavExpand, setMobileNavExpand] = useState<'paths' | 'skills' | null>(null);
  const [focusedItemIndex, setFocusedItemIndex] = useState(-1);
  const [focusedNavIndex, setFocusedNavIndex] = useState(0);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  const notificationRef = useRef<HTMLDivElement>(null);
  const mobileMenuRef = useRef<HTMLDivElement>(null);
  const mobileMenuToggleRef = useRef<HTMLButtonElement>(null);
  const navItemsRef = useRef<(HTMLButtonElement | HTMLAnchorElement | null)[]>([]);

  const unreadCount = notifications.filter(n => !n.read).length;

  useEffect(() => {
    if (activeView !== 'catalog' || typeof window === 'undefined') return;
    if (!window.matchMedia('(max-width: 767px)').matches) return;
    setOpenDropdown((d) => (d === 'notifications' ? null : d));
  }, [activeView]);

  useBodyScrollLock(mobileMenuOpen);

  const skillItems = catalogBrowseSkills;

  const tagIsActive = (active: readonly string[], item: string) => {
    const k = item.trim().toLowerCase();
    return active.some((t) => t.trim().toLowerCase() === k);
  };

  const getItems = () => {
    if (openDropdown === 'paths') return learningPaths.map((_, i) => `__path_${i}`);
    if (openDropdown === 'skills') return skillItems;
    return [];
  };

  const handleItemSelect = (item: string) => {
    if (openDropdown === 'paths') {
      const m = /^__path_(\d+)$/.exec(item);
      if (m) {
        const path = learningPaths[Number(m[1])];
        if (path) {
          onPathSelect(
            path.id,
            path.fromCreatorDraft === true,
            path.adminPreviewOwnerUid
          );
        }
      }
    }
    if (openDropdown === 'skills') onSkillSelect(item);
    setOpenDropdown(null);
    setFocusedItemIndex(-1);
  };

  useEffect(() => {
    const closeMenusFromVideoInteraction = () => {
      setMobileMenuOpen(false);
      setMobileNavExpand(null);
      setOpenDropdown(null);
      setFocusedItemIndex(-1);
    };

    const onPointerDownCapture = (event: PointerEvent) => {
      const t = event.target;
      if (!(t instanceof Element)) return;
      if (!t.closest('[data-igolden-video-area]')) return;
      closeMenusFromVideoInteraction();
    };
    document.addEventListener('pointerdown', onPointerDownCapture, true);
    return () => document.removeEventListener('pointerdown', onPointerDownCapture, true);
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (dropdownRef.current && !dropdownRef.current.contains(target) &&
          profileRef.current && !profileRef.current.contains(target) &&
          notificationRef.current && !notificationRef.current.contains(target)) {
        setOpenDropdown(null);
        setFocusedItemIndex(-1);
      }
      if (
        mobileMenuOpen &&
        mobileMenuRef.current &&
        !mobileMenuRef.current.contains(target) &&
        mobileMenuToggleRef.current &&
        !mobileMenuToggleRef.current.contains(target)
      ) {
        setMobileMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [mobileMenuOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (openDropdown !== null) {
        e.preventDefault();
        setOpenDropdown(null);
        setFocusedItemIndex(-1);
        return;
      }
      if (mobileMenuOpen) {
        e.preventDefault();
        setMobileMenuOpen(false);
        setMobileNavExpand(null);
        return;
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [openDropdown, mobileMenuOpen]);

  /** Move focus into the page when the drawer opens so Esc reaches document (e.g. after YouTube iframe had focus). */
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const id = requestAnimationFrame(() => {
      mobileMenuRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(id);
  }, [mobileMenuOpen]);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const onChange = () => {
      if (mq.matches) {
        setMobileMenuOpen(false);
        setMobileNavExpand(null);
      }
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const markAllAsRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  };

  const removeNotification = (id: string) => {
    const n = notifications.find((x) => x.id === id);
    if (n) onDismissNotification?.(n);
    setNotifications(prev => prev.filter((x) => x.id !== id));
  };

  const clearAllNotifications = () => {
    onClearAllNotifications?.();
    if (notifications.some((n) => n.id === 'welcome')) {
      onGuestClearNotifications?.();
    }
    for (const n of notifications) {
      onDismissNotification?.(n);
    }
    setNotifications([]);
  };

  const handleTopLevelKeyDown = (e: React.KeyboardEvent, index: number, type?: 'paths' | 'skills' | 'profile' | 'notifications') => {
    // If dropdown is open, handle vertical navigation
    if (openDropdown === type && type) {
      const items = getItems();
      if (items.length === 0) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedItemIndex(prev => (prev + 1) % items.length);
        return;
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (focusedItemIndex === 0) {
          setOpenDropdown(null);
          setFocusedItemIndex(-1);
        } else {
          setFocusedItemIndex(prev => (prev - 1 + items.length) % items.length);
        }
        return;
      } else if (e.key === 'Enter' && focusedItemIndex !== -1) {
        e.preventDefault();
        handleItemSelect(items[focusedItemIndex]);
        return;
      }
    }

    if (e.key === 'ArrowRight') {
      e.preventDefault();
      const nextIndex = (index + 1) % navItemsRef.current.length;
      setFocusedNavIndex(nextIndex);
      navItemsRef.current[nextIndex]?.focus();
      setOpenDropdown(null);
      setFocusedItemIndex(-1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const prevIndex = (index - 1 + navItemsRef.current.length) % navItemsRef.current.length;
      setFocusedNavIndex(prevIndex);
      navItemsRef.current[prevIndex]?.focus();
      setOpenDropdown(null);
      setFocusedItemIndex(-1);
    } else if (e.key === 'ArrowDown' && type) {
      e.preventDefault();
      setOpenDropdown(type);
      setFocusedItemIndex(0);
    } else if (e.key === 'Escape') {
      setOpenDropdown(null);
      setFocusedItemIndex(-1);
    }
  };

  if (immersiveHidden) {
    return null;
  }

  return (
    <>
    <nav className="fixed top-0 left-0 right-0 z-50 flex min-h-16 items-center justify-between gap-2 overflow-visible border-b border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 transition-colors duration-300 app-dark:[--nav-fg:#f2f2f2] app-dark:[--nav-soft:#e4e4e4] sm:gap-3 sm:px-4 md:px-6">
      <div className="flex min-w-0 flex-1 items-center gap-2 md:gap-6 lg:gap-8">
        <a
          href={NAV_HOME_HREF}
          ref={(el) => {
            navItemsRef.current[0] = el;
          }}
          onKeyDown={(e) => handleTopLevelKeyDown(e, 0)}
          tabIndex={focusedNavIndex === 0 ? 0 : -1}
          className={`flex items-center gap-2 rounded-sm no-underline transition-opacity focus:outline-none focus:ring-2 focus:ring-brand-500 ${activeView === 'home' ? 'opacity-100' : 'opacity-70 hover:opacity-100'}`}
          onClick={(e) => {
            if (skipModifiedNavClick(e)) return;
            e.preventDefault();
            onNavigate('home');
          }}
          aria-label="i Golden, home"
        >
          <div
            className={`flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-sm transition-colors ${activeView === 'home' ? 'bg-brand-500' : 'bg-[var(--text-muted)]'}`}
          >
            <img
              src={`${import.meta.env.BASE_URL}i-golden-mark.svg`}
              alt=""
              width={32}
              height={32}
              decoding="async"
              className="size-8 object-cover"
            />
          </div>
          <span className="hidden min-w-0 flex-col items-start sm:flex">
            <span
              className={`text-xl font-bold tracking-tighter transition-colors ${activeView === 'home' ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)] app-dark:text-[color:var(--nav-fg)]'}`}
            >
              i Golden
            </span>
            <span className="hidden max-w-[11rem] text-[0.625rem] font-semibold leading-snug tracking-wide text-[var(--text-secondary)] app-dark:text-[color:var(--nav-soft)] lg:block lg:max-w-[13rem]">
              Learn Today. Lead Tomorrow.
            </span>
          </span>
        </a>
        
        <div
          className={`hidden items-center gap-6 text-sm font-medium text-[var(--text-secondary)] app-dark:text-[color:var(--nav-fg)] ${
            activeView === 'catalog' ? 'lg:flex' : 'md:flex'
          }`}
          ref={dropdownRef}
        >
          <a
            href={NAV_CATALOG_HREF}
            ref={(el) => {
              navItemsRef.current[1] = el;
            }}
            onKeyDown={(e) => handleTopLevelKeyDown(e, 1)}
            onClick={(e) => {
              if (skipModifiedNavClick(e)) return;
              e.preventDefault();
              setOpenDropdown(null);
              setFocusedItemIndex(-1);
              onNavigate('catalog');
            }}
            tabIndex={focusedNavIndex === 1 ? 0 : -1}
            aria-current={activeView === 'catalog' && !learningPathNavActive ? 'page' : undefined}
            className={`inline-flex h-16 cursor-pointer items-center no-underline transition-colors hover:text-[var(--text-primary)] focus:text-[var(--text-primary)] focus:outline-none app-dark:hover:text-white app-dark:focus:text-white ${
              activeView === 'catalog' && !learningPathNavActive
                ? 'border-b-2 border-brand-500 text-brand-500'
                : 'text-[var(--text-secondary)] app-dark:text-[color:var(--nav-fg)]'
            }`}
          >
            Browse Catalog
          </a>

          {/* Learning Paths dropdown */}
          <div className="relative">
            <button
              ref={(el) => {
                navItemsRef.current[2] = el;
              }}
              onKeyDown={(e) => handleTopLevelKeyDown(e, 2, 'paths')}
              onClick={() => {
                setOpenDropdown(openDropdown === 'paths' ? null : 'paths');
                setFocusedItemIndex(-1);
              }}
              tabIndex={focusedNavIndex === 2 ? 0 : -1}
              aria-current={learningPathNavActive ? 'page' : undefined}
              className={`flex h-16 items-center gap-1 transition-colors focus:text-[var(--text-primary)] focus:outline-none hover:text-[var(--text-primary)] app-dark:hover:text-white app-dark:focus:text-white ${
                learningPathNavActive ? 'border-b-2 border-brand-500 text-brand-500' : 'text-[var(--text-secondary)] app-dark:text-[color:var(--nav-fg)]'
              }`}
            >
              Learning Paths{' '}
              <ChevronDown size={14} className={`${openDropdown === 'paths' ? 'rotate-180' : ''} transition-transform`} />
            </button>
            {openDropdown === 'paths' && (
              <div 
                className="absolute top-full left-0 w-56 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-b-lg shadow-xl py-2 z-50"
              >
                {learningPaths.length === 0 ? (
                  <p className="px-4 py-2 text-sm text-[var(--text-secondary)] app-dark:text-[color:var(--nav-soft)]">
                    No Learning Paths yet
                  </p>
                ) : (
                  learningPaths.map((path, index) => (
                    <a
                      key={`${path.id}:${path.fromCreatorDraft ? 'd' : 'p'}:${path.adminPreviewOwnerUid ?? ''}`}
                      href={catalogLearningPathHref(path.id)}
                      onClick={(e) => {
                        if (skipModifiedNavClick(e)) return;
                        e.preventDefault();
                        handleItemSelect(`__path_${index}`);
                      }}
                      onMouseEnter={() => setFocusedItemIndex(index)}
                      className={`block w-full cursor-pointer px-4 py-2 text-left no-underline transition-colors focus:outline-none ${focusedItemIndex === index ? 'bg-[var(--hover-bg)] text-brand-500' : 'hover:bg-[var(--hover-bg)] hover:text-brand-500'}`}
                    >
                      {path.title || path.id}
                      {path.adminPreviewOwnerUid ? (
                        <span className="ml-1 text-[10px] font-semibold uppercase tracking-wide text-brand-500">
                          · Creator preview
                        </span>
                      ) : path.fromCreatorDraft === true ||
                        (path.fromCreatorDraft !== false && privatePathIds.has(path.id)) ? (
                        <span className="ml-1 text-[10px] font-semibold uppercase tracking-wide text-brand-500">
                          · Draft
                        </span>
                      ) : null}
                    </a>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Skills Dropdown */}
          <div className="relative">
            <button
              ref={(el) => {
                navItemsRef.current[3] = el;
              }}
              onKeyDown={(e) => handleTopLevelKeyDown(e, 3, 'skills')}
              onClick={() => {
                setOpenDropdown(openDropdown === 'skills' ? null : 'skills');
                setFocusedItemIndex(-1);
              }}
              tabIndex={focusedNavIndex === 3 ? 0 : -1}
              className="text-[var(--text-secondary)] app-dark:text-[color:var(--nav-fg)] hover:text-[var(--text-primary)] transition-colors flex items-center gap-1 h-16 focus:outline-none focus:text-[var(--text-primary)] app-dark:hover:text-white app-dark:focus:text-white"
            >
              Skills <ChevronDown size={14} className={`${openDropdown === 'skills' ? 'rotate-180' : ''} transition-transform`} />
            </button>
            {openDropdown === 'skills' && (
              <div 
                className="absolute top-full left-0 w-56 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-b-lg shadow-xl py-2 z-50"
              >
                {skillItems.map((item, index) => {
                  const selected = tagIsActive(catalogActiveSkillTags, item);
                  return (
                    <button
                      key={item}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => handleItemSelect(item)}
                      onMouseEnter={() => setFocusedItemIndex(index)}
                      className={`w-full min-h-10 text-left px-4 py-2 transition-colors focus:outline-none ${selected ? 'bg-brand-500/15 font-medium text-brand-500' : ''} ${focusedItemIndex === index ? 'bg-[var(--hover-bg)] text-brand-500' : 'hover:bg-[var(--hover-bg)] hover:text-brand-500'}`}
                    >
                      {item}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <a
            href={NAV_CONTACT_HREF}
            ref={(el) => {
              navItemsRef.current[4] = el;
            }}
            onClick={(e) => {
              if (skipModifiedNavClick(e)) return;
              e.preventDefault();
              setOpenDropdown(null);
              setFocusedItemIndex(-1);
              onNavigate('contact');
            }}
            onKeyDown={(e) => handleTopLevelKeyDown(e, 4)}
            tabIndex={focusedNavIndex === 4 ? 0 : -1}
            className={`inline-flex h-16 cursor-pointer items-center no-underline transition-colors hover:text-[var(--text-primary)] focus:text-[var(--text-primary)] focus:outline-none app-dark:hover:text-white app-dark:focus:text-white ${activeView === 'contact' ? 'border-b-2 border-brand-500 text-brand-500' : 'text-[var(--text-secondary)] app-dark:text-[color:var(--nav-fg)]'}`}
          >
            Contact Us
          </a>
        </div>

        {catalogNavFilter ? (
          <div className="min-w-0 flex-1 py-1">{catalogNavFilter}</div>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-2 sm:gap-4">
        <button
          type="button"
          onClick={() => {
            setOpenDropdown(null);
            setMobileMenuOpen(false);
            onThemeToggle();
          }}
          className="hidden rounded-lg p-2 text-[var(--text-secondary)] app-dark:text-[color:var(--nav-fg)] hover:bg-[var(--hover-bg)] hover:text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-brand-500/50 app-dark:hover:text-white md:inline-flex md:items-center md:justify-center"
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
        >
          {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
        </button>

        {/* Notifications — hidden on small screens while browsing catalog so the filter bar has room. */}
        <div
          className={`relative ${activeView === 'catalog' ? 'max-md:hidden' : ''}`}
          ref={notificationRef}
        >
          <button 
            type="button"
            onClick={() => {
              setMobileMenuOpen(false);
              setOpenDropdown(openDropdown === 'notifications' ? null : 'notifications');
              if (openDropdown !== 'notifications') markAllAsRead();
            }}
            className="p-2 text-[var(--text-secondary)] app-dark:text-[color:var(--nav-fg)] hover:text-[var(--text-primary)] relative focus:outline-none focus:text-[var(--text-primary)] app-dark:hover:text-white"
          >
            <Bell size={20} />
            {unreadCount > 0 && (
              <span className="absolute top-1.5 right-1.5 w-4 h-4 bg-brand-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center border-2 border-[var(--bg-secondary)]">
                {unreadCount}
              </span>
            )}
          </button>

          {openDropdown === 'notifications' && (
            <div
              className="z-[60] flex max-h-[min(24rem,calc(100dvh-5.5rem))] w-[min(20rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-xl max-md:fixed max-md:left-3 max-md:right-3 max-md:top-[4.5rem] max-md:mx-auto max-md:max-h-[min(70dvh,calc(100dvh-5.5rem))] max-md:w-auto md:absolute md:right-0 md:top-full md:mt-2 md:max-h-96 md:w-80"
              role="dialog"
              aria-modal="false"
              aria-label="Notifications"
            >
              <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border-color)] p-4">
                <h3 className="text-sm font-bold text-[var(--text-primary)]">Notifications</h3>
                {notifications.length > 0 ? (
                  <button
                    type="button"
                    onClick={clearAllNotifications}
                    className="shrink-0 text-xs font-semibold text-brand-500 transition-colors hover:text-brand-400"
                  >
                    Clear All
                  </button>
                ) : (
                  <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Recent</span>
                )}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                {notifications.length > 0 ? (
                  notifications.map(n => (
                    <div
                      key={n.id}
                      className="flex gap-2 border-b border-[var(--border-color)] p-2 transition-colors last:border-0 hover:bg-[var(--hover-bg)]"
                    >
                      <button
                        type="button"
                        className="min-w-0 flex-1 rounded-lg px-2 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand-500/60"
                        onClick={() => {
                          onNotificationAction(n);
                          setOpenDropdown(null);
                          setNotifications((prev) =>
                            prev.map((x) => (x.id === n.id ? { ...x, read: true } : x))
                          );
                        }}
                      >
                        <p className="mb-1 text-sm leading-snug text-[var(--text-primary)]">{n.message}</p>
                        <span className="text-[10px] text-[var(--text-muted)]">{n.time}</span>
                        {n.kind === 'certificate' && (
                          <span className="mt-1 block text-[10px] font-semibold text-brand-500">View in profile</span>
                        )}
                        {n.kind === 'broadcast' && (
                          <span className="mt-1 block text-[10px] font-semibold text-brand-500">Open course</span>
                        )}
                        {n.kind === 'generic' && n.actionLabel && (
                          <span className="mt-1 block text-[10px] font-semibold text-brand-500">{n.actionLabel}</span>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeNotification(n.id);
                        }}
                        className="mt-1 h-8 shrink-0 self-start rounded-md p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--border-color)] hover:text-[var(--text-primary)]"
                        aria-label="Dismiss notification"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="p-8 text-center text-[var(--text-muted)]">
                    <BellRing size={32} className="mx-auto mb-2 opacity-20" />
                    <p className="text-sm">No notifications</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* User Profile / Login — top bar from md up; mobile uses hamburger account section. */}
        <div className="relative hidden h-10 shrink-0 items-center md:flex" ref={profileRef}>
          {user ? (
            <>
              <button 
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  setOpenDropdown(openDropdown === 'profile' ? null : 'profile');
                }}
                aria-label={accountMenuAriaLabel(user)}
                className="h-8 w-8 shrink-0 cursor-pointer rounded-full border-2 border-brand-500 p-0 text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-secondary)] overflow-hidden flex items-center justify-center"
              >
                <NavProfileAvatar user={user} />
              </button>

              {openDropdown === 'profile' && (
                <div
                  className="z-[60] max-h-[min(32rem,calc(100dvh-5.5rem))] w-[min(16rem,calc(100vw-1.5rem))] overflow-y-auto overscroll-contain rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-xl max-md:fixed max-md:left-3 max-md:right-3 max-md:top-[4.5rem] max-md:mx-auto max-md:max-h-[min(80dvh,calc(100dvh-5.5rem))] max-md:w-auto md:absolute md:right-0 md:top-full md:mt-2 md:w-64 md:max-h-none md:overflow-visible"
                  role="menu"
                  aria-label="Account menu"
                >
                  <div className="border-b border-[var(--border-color)] p-6 flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <h2 className="text-xl font-bold text-[var(--text-primary)] truncate">
                        {user.displayName || 'Account'}
                      </h2>
                      <div className="break-all text-xs text-[var(--text-muted)] mt-0.5">{user.email}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setOpenDropdown(null)}
                      className="shrink-0 p-2 hover:bg-[var(--hover-bg)] rounded-lg transition-colors text-[var(--text-secondary)]"
                      aria-label="Close menu"
                    >
                      <X size={20} />
                    </button>
                  </div>
                  <div className="py-2">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setOpenDropdown(null);
                        onNavigate('profile');
                      }}
                      className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm text-[var(--text-secondary)] transition-colors hover:bg-[var(--hover-bg)] hover:text-[var(--text-primary)]"
                    >
                      <User size={16} aria-hidden />
                      Profile Details
                    </button>
                    {isCreator && (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setOpenDropdown(null);
                          onNavigate('creator');
                        }}
                        className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm text-[var(--text-secondary)] transition-colors hover:bg-[var(--hover-bg)] hover:text-[var(--text-primary)]"
                      >
                        <PenLine size={16} aria-hidden />
                        Creator studio
                      </button>
                    )}
                    {isAdmin && (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setOpenDropdown(null);
                          onNavigate('admin');
                        }}
                        className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm text-brand-500 transition-colors hover:bg-brand-500/10"
                      >
                        <Shield size={16} aria-hidden />
                        Admin
                      </button>
                    )}
                  </div>
                  <div className="border-t border-[var(--border-color)] py-2">
                    <button 
                      onClick={() => {
                        setOpenDropdown(null);
                        onLogout();
                      }}
                      className="w-full flex items-center gap-3 px-4 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors text-left"
                    >
                      <LogOut size={16} />
                      Logout
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : !isAuthReady ? (
            <div
              className="h-8 w-8 shrink-0 rounded-full bg-[var(--hover-bg)] animate-pulse"
              aria-busy="true"
              aria-label="Loading account"
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                setMobileMenuOpen(false);
                openSignInModal();
              }}
              className="flex items-center gap-2 rounded-md bg-brand-500 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-brand-600"
            >
              <LogIn size={16} aria-hidden />
              Sign in
            </button>
          )}
        </div>

        <button
          ref={mobileMenuToggleRef}
          type="button"
          className={`p-2 text-[var(--text-secondary)] app-dark:text-[color:var(--nav-fg)] hover:text-[var(--text-primary)] app-dark:hover:text-white ${
            activeView === 'catalog' ? 'lg:hidden' : 'md:hidden'
          }`}
          onClick={() => {
            setMobileMenuOpen((open) => !open);
            setOpenDropdown(null);
          }}
          aria-expanded={mobileMenuOpen}
          aria-controls="mobile-nav-drawer"
          aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
        >
          {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {mobileMenuOpen && (
        <>
          <button
            type="button"
            className={`fixed inset-0 top-16 z-[45] bg-black/50 ${
              activeView === 'catalog' ? 'lg:hidden' : 'md:hidden'
            }`}
            aria-label="Close menu"
            onClick={() => {
              setMobileMenuOpen(false);
              setMobileNavExpand(null);
            }}
          />
          <div
            id="mobile-nav-drawer"
            ref={mobileMenuRef}
            tabIndex={-1}
            className={`fixed bottom-0 left-0 top-16 z-[46] flex w-full max-w-sm flex-col overflow-y-auto overscroll-contain border-r border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-xl outline-none focus:outline-none app-dark:[--nav-fg:#f2f2f2] app-dark:[--nav-soft:#e4e4e4] ${
              activeView === 'catalog' ? 'lg:hidden' : 'md:hidden'
            }`}
            role="dialog"
            aria-modal="true"
            aria-label="Main navigation"
          >
            <div className="border-b border-[var(--border-color)] p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] app-dark:text-[color:var(--nav-soft)]">
                Menu
              </p>
            </div>
            <div className="border-b border-[var(--border-color)] px-2 py-2">
              <button
                type="button"
                className="flex w-full min-h-11 items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-semibold text-[var(--text-primary)] hover:bg-[var(--hover-bg)] touch-manipulation"
                onClick={() => onThemeToggle()}
                aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              >
                {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
                {theme === 'dark' ? 'Light mode' : 'Dark mode'}
              </button>
            </div>
            <div className="border-b border-[var(--border-color)] px-2 py-2">
              {user ? (
                <div className="flex flex-col gap-0.5">
                  <button
                    type="button"
                    className="flex w-full min-h-11 items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-semibold text-[var(--text-primary)] hover:bg-[var(--hover-bg)] touch-manipulation"
                    onClick={() => {
                      onNavigate('profile');
                      setMobileMenuOpen(false);
                      setMobileNavExpand(null);
                    }}
                  >
                    <User size={18} className="shrink-0 text-[var(--text-secondary)]" aria-hidden />
                    Profile
                  </button>
                  {isCreator && (
                    <button
                      type="button"
                      className="flex w-full min-h-11 items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-semibold text-[var(--text-primary)] hover:bg-[var(--hover-bg)] touch-manipulation"
                      onClick={() => {
                        onNavigate('creator');
                        setMobileMenuOpen(false);
                        setMobileNavExpand(null);
                      }}
                    >
                      <PenLine size={18} className="shrink-0 text-[var(--text-secondary)]" aria-hidden />
                      Creator studio
                    </button>
                  )}
                  {isAdmin && (
                    <button
                      type="button"
                      className="flex w-full min-h-11 items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-semibold text-brand-500 hover:bg-brand-500/10 touch-manipulation"
                      onClick={() => {
                        onNavigate('admin');
                        setMobileMenuOpen(false);
                        setMobileNavExpand(null);
                      }}
                    >
                      <Shield size={18} className="shrink-0" aria-hidden />
                      Admin
                    </button>
                  )}
                  <button
                    type="button"
                    className="flex w-full min-h-11 items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-semibold text-red-400 hover:bg-red-500/10 touch-manipulation"
                    onClick={() => {
                      setMobileMenuOpen(false);
                      setMobileNavExpand(null);
                      onLogout();
                    }}
                  >
                    <LogOut size={18} className="shrink-0" aria-hidden />
                    Logout
                  </button>
                </div>
              ) : !isAuthReady ? (
                <p className="px-3 py-2 text-xs text-[var(--text-muted)]">Checking account…</p>
              ) : (
                <button
                  type="button"
                  className="flex w-full min-h-11 items-center justify-center gap-2 rounded-lg bg-brand-500 px-3 py-2.5 text-left text-sm font-bold text-white hover:bg-brand-600 touch-manipulation"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    openSignInModal();
                  }}
                >
                  <LogIn size={18} className="shrink-0" aria-hidden />
                  Sign in
                </button>
              )}
            </div>
            <div className="flex flex-col py-2 text-sm font-medium text-[var(--text-secondary)] app-dark:text-[color:var(--nav-fg)]">
              <a
                href={NAV_CATALOG_HREF}
                className={`block px-4 py-3 text-left no-underline transition-colors hover:bg-[var(--hover-bg)] hover:text-[var(--text-primary)] ${
                  activeView === 'catalog' && !learningPathNavActive ? 'text-brand-500' : ''
                }`}
                onClick={(e) => {
                  if (skipModifiedNavClick(e)) return;
                  e.preventDefault();
                  /* Default shouldClear=true matches desktop Browse Catalog: clears learning path + library filters. */
                  onNavigate('catalog');
                  setMobileMenuOpen(false);
                }}
              >
                Browse Catalog
              </a>
              <div className="border-t border-[var(--border-color)]">
                <button
                  type="button"
                  className={`flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-[var(--hover-bg)] ${
                    learningPathNavActive ? 'text-brand-500' : ''
                  }`}
                  onClick={() => setMobileNavExpand((e) => (e === 'paths' ? null : 'paths'))}
                  aria-expanded={mobileNavExpand === 'paths'}
                >
                  <span>Learning Paths</span>
                  <ChevronDown size={16} className={`shrink-0 transition-transform ${mobileNavExpand === 'paths' ? 'rotate-180' : ''}`} />
                </button>
                {mobileNavExpand === 'paths' && (
                  <div className="border-t border-[var(--border-color)] bg-[var(--bg-primary)]/30 pb-2">
                    {learningPaths.length === 0 ? (
                      <p className="px-6 py-2.5 text-sm text-[var(--text-secondary)] app-dark:text-[color:var(--nav-soft)]">
                        No Learning Paths yet
                      </p>
                    ) : (
                      learningPaths.map((path) => (
                        <a
                          key={`${path.id}:${path.fromCreatorDraft ? 'd' : 'p'}:${path.adminPreviewOwnerUid ?? ''}`}
                          href={catalogLearningPathHref(path.id)}
                          className="block w-full cursor-pointer px-6 py-2.5 text-left text-sm no-underline hover:bg-[var(--hover-bg)] hover:text-brand-500"
                          onClick={(e) => {
                            if (skipModifiedNavClick(e)) return;
                            e.preventDefault();
                            onPathSelect(
                              path.id,
                              path.fromCreatorDraft === true,
                              path.adminPreviewOwnerUid
                            );
                            setMobileMenuOpen(false);
                            setMobileNavExpand(null);
                          }}
                        >
                          {path.title || path.id}
                          {path.adminPreviewOwnerUid ? (
                            <span className="ml-1 text-[10px] font-semibold uppercase text-brand-500">
                              · Creator preview
                            </span>
                          ) : path.fromCreatorDraft === true ||
                            (path.fromCreatorDraft !== false && privatePathIds.has(path.id)) ? (
                            <span className="ml-1 text-[10px] font-semibold uppercase text-brand-500">· Draft</span>
                          ) : null}
                        </a>
                      ))
                    )}
                  </div>
                )}
              </div>
              <div className="border-t border-[var(--border-color)]">
                <button
                  type="button"
                  className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-[var(--hover-bg)]"
                  onClick={() => setMobileNavExpand((e) => (e === 'skills' ? null : 'skills'))}
                  aria-expanded={mobileNavExpand === 'skills'}
                >
                  <span>Skills</span>
                  <ChevronDown size={16} className={`shrink-0 transition-transform ${mobileNavExpand === 'skills' ? 'rotate-180' : ''}`} />
                </button>
                {mobileNavExpand === 'skills' && (
                  <div className="border-t border-[var(--border-color)] bg-[var(--bg-primary)]/30 pb-2">
                    {skillItems.map((item) => {
                      const selected = tagIsActive(catalogActiveSkillTags, item);
                      return (
                        <button
                          key={item}
                          type="button"
                          aria-pressed={selected}
                          className={`w-full min-h-11 px-6 py-2.5 text-left text-sm transition-colors ${selected ? 'bg-brand-500/15 font-medium text-brand-500' : 'hover:bg-[var(--hover-bg)] hover:text-brand-500'}`}
                          onClick={() => {
                            onSkillSelect(item);
                          }}
                        >
                          {item}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <a
                href={NAV_CONTACT_HREF}
                className={`block border-t border-[var(--border-color)] px-4 py-3 text-left text-[var(--text-secondary)] no-underline transition-colors hover:bg-[var(--hover-bg)] hover:text-[var(--text-primary)] app-dark:text-[color:var(--nav-fg)] app-dark:hover:text-white ${activeView === 'contact' ? 'text-brand-500 app-dark:text-brand-500' : ''}`}
                onClick={(e) => {
                  if (skipModifiedNavClick(e)) return;
                  e.preventDefault();
                  onNavigate('contact');
                  setMobileMenuOpen(false);
                  setMobileNavExpand(null);
                }}
              >
                Contact Us
              </a>
            </div>
          </div>
        </>
      )}
    </nav>
    {openDropdown !== null &&
      createPortal(
        <div
          className="fixed inset-0 top-16 z-[48] hidden md:block"
          aria-hidden
          onPointerDown={() => {
            setOpenDropdown(null);
            setFocusedItemIndex(-1);
          }}
        />,
        document.body
      )}
  </>
  );
};
