import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { Menu, User, Bell, ChevronDown, X, LogOut, Moon, Sun, BellRing, LogIn, Shield } from 'lucide-react';
import { User as FirebaseUser } from '../firebase';
import type { AuthProfileSnapshot } from '../utils/authProfileCache';
export interface NavbarNotification {
  id: string;
  message: string;
  read: boolean;
  time: string;
  kind?: 'certificate' | 'broadcast' | 'generic';
  actionView?: 'home' | 'catalog' | 'contact' | 'profile' | 'admin';
  adminTab?: 'alerts' | 'ai' | 'catalog' | 'moderation' | 'roles';
  /** When opening Admin → Moderation, which inbox sub-tab to show. */
  adminModerationSubTab?: 'reports' | 'suggestions' | 'contact';
  actionLabel?: string;
  courseId?: string;
  lessonId?: string;
  moduleId?: string;
  alertId?: string;
}

interface NavbarProps {
  onNavigate: (view: 'home' | 'catalog' | 'contact' | 'profile' | 'admin', clear?: boolean) => void;
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
  /** Titles and ids from Firestore `learningPaths` (same as admin Path builder). */
  learningPaths?: ReadonlyArray<{ id: string; title: string }>;
  /** Path document id from `learningPaths`. */
  onPathSelect: (pathId: string) => void;
  onSkillSelect: (skill: string) => void;
  theme: 'dark' | 'light';
  onThemeToggle: () => void;
  /** False until Firebase has reported initial auth state (avoids flashing "Login" when the user is already signed in). */
  isAuthReady: boolean;
  /** Firebase user or last-known profile from localStorage while auth restores (avatar only). */
  user: FirebaseUser | AuthProfileSnapshot | null;
  onLogin: () => void;
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
  onPathSelect,
  onSkillSelect,
  theme,
  onThemeToggle,
  isAuthReady,
  user,
  onLogin,
  onLogout,
  notifications,
  setNotifications,
  onNotificationAction,
  onDismissNotification,
  onClearAllNotifications,
  onGuestClearNotifications,
  isAdmin = false,
  immersiveHidden = false,
}) => {
  const [openDropdown, setOpenDropdown] = useState<'browse' | 'paths' | 'skills' | 'profile' | 'notifications' | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileNavExpand, setMobileNavExpand] = useState<'browse' | 'paths' | 'skills' | null>(null);
  const [focusedItemIndex, setFocusedItemIndex] = useState(-1);
  const [focusedNavIndex, setFocusedNavIndex] = useState(0);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  const notificationRef = useRef<HTMLDivElement>(null);
  const mobileMenuRef = useRef<HTMLDivElement>(null);
  const mobileMenuToggleRef = useRef<HTMLButtonElement>(null);
  const navItemsRef = useRef<(HTMLButtonElement | null)[]>([]);

  const unreadCount = notifications.filter(n => !n.read).length;

  useBodyScrollLock(mobileMenuOpen);

  const browseItems = catalogBrowseCategories;
  const skillItems = catalogBrowseSkills;

  const tagIsActive = (active: readonly string[], item: string) => {
    const k = item.trim().toLowerCase();
    return active.some((t) => t.trim().toLowerCase() === k);
  };

  const getItems = () => {
    if (openDropdown === 'browse') return browseItems;
    if (openDropdown === 'paths') return learningPaths.map((p) => p.id);
    if (openDropdown === 'skills') return skillItems;
    return [];
  };

  const handleItemSelect = (item: string) => {
    if (openDropdown === 'browse') onCategorySelect(item);
    if (openDropdown === 'paths') onPathSelect(item);
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
      if (!t.closest('[data-skillstream-video-area]')) return;
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

  const handleTopLevelKeyDown = (e: React.KeyboardEvent, index: number, type?: 'browse' | 'paths' | 'skills' | 'profile' | 'notifications') => {
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
    <nav className="fixed top-0 left-0 right-0 z-50 flex min-h-16 items-center justify-between gap-2 overflow-visible border-b border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 transition-colors duration-300 sm:gap-3 sm:px-4 md:px-6">
      <div className="flex min-w-0 flex-1 items-center gap-2 md:gap-6 lg:gap-8">
        <button 
          ref={el => navItemsRef.current[0] = el}
          onKeyDown={(e) => handleTopLevelKeyDown(e, 0)}
          tabIndex={focusedNavIndex === 0 ? 0 : -1}
          className={`flex items-center gap-2 transition-opacity focus:outline-none focus:ring-2 focus:ring-orange-500 rounded-sm ${activeView === 'home' ? 'opacity-100' : 'opacity-70 hover:opacity-100'}`}
          onClick={() => onNavigate('home')}
        >
          <div className={`w-8 h-8 rounded-sm flex items-center justify-center font-bold text-white transition-colors ${activeView === 'home' ? 'bg-orange-500' : 'bg-[var(--text-muted)]'}`}>S</div>
          <span className={`text-xl font-bold tracking-tighter hidden sm:block transition-colors ${activeView === 'home' ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>SKILLSTREAM</span>
        </button>
        
        <div className="hidden md:flex items-center gap-6 text-sm font-medium text-[var(--text-secondary)]" ref={dropdownRef}>
          {/* Browse Dropdown */}
          <div className="relative">
            <button 
              type="button"
              ref={el => navItemsRef.current[1] = el}
              onKeyDown={(e) => handleTopLevelKeyDown(e, 1, 'browse')}
              onClick={() => {
                setOpenDropdown(openDropdown === 'browse' ? null : 'browse');
                setFocusedItemIndex(-1);
              }}
              tabIndex={focusedNavIndex === 1 ? 0 : -1}
              className={`hover:text-[var(--text-primary)] transition-colors flex items-center gap-1 h-16 focus:outline-none focus:text-[var(--text-primary)] ${activeView === 'catalog' ? 'text-orange-500 border-b-2 border-orange-500' : 'text-[var(--text-secondary)]'}`}
            >
              Browse <ChevronDown size={14} className={`${openDropdown === 'browse' ? 'rotate-180' : ''} transition-transform`} />
            </button>
            {openDropdown === 'browse' && (
              <div 
                className="absolute top-full left-0 w-56 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-b-lg shadow-xl py-2 z-50"
              >
                {browseItems.map((item, index) => {
                  const selected = tagIsActive(catalogActiveCategoryTags, item);
                  return (
                    <button
                      key={item}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => handleItemSelect(item)}
                      onMouseEnter={() => setFocusedItemIndex(index)}
                      className={`w-full min-h-10 text-left px-4 py-2 transition-colors focus:outline-none ${selected ? 'bg-orange-500/15 font-medium text-orange-500' : ''} ${focusedItemIndex === index ? 'bg-[var(--hover-bg)] text-orange-500' : 'hover:bg-[var(--hover-bg)] hover:text-orange-500'}`}
                    >
                      {item}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Paths Dropdown */}
          <div className="relative">
            <button 
              ref={el => navItemsRef.current[2] = el}
              onKeyDown={(e) => handleTopLevelKeyDown(e, 2, 'paths')}
              onClick={() => {
                setOpenDropdown(openDropdown === 'paths' ? null : 'paths');
                setFocusedItemIndex(-1);
              }}
              tabIndex={focusedNavIndex === 2 ? 0 : -1}
              className="hover:text-[var(--text-primary)] transition-colors flex items-center gap-1 h-16 focus:outline-none focus:text-[var(--text-primary)]"
            >
              Paths <ChevronDown size={14} className={`${openDropdown === 'paths' ? 'rotate-180' : ''} transition-transform`} />
            </button>
            {openDropdown === 'paths' && (
              <div 
                className="absolute top-full left-0 w-56 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-b-lg shadow-xl py-2 z-50"
              >
                {learningPaths.length === 0 ? (
                  <p className="px-4 py-2 text-sm text-[var(--text-muted)]">No learning paths yet</p>
                ) : (
                  learningPaths.map((path, index) => (
                    <button
                      key={path.id}
                      type="button"
                      onClick={() => handleItemSelect(path.id)}
                      onMouseEnter={() => setFocusedItemIndex(index)}
                      className={`w-full text-left px-4 py-2 transition-colors focus:outline-none ${focusedItemIndex === index ? 'bg-[var(--hover-bg)] text-orange-500' : 'hover:bg-[var(--hover-bg)] hover:text-orange-500'}`}
                    >
                      {path.title || path.id}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Skills Dropdown */}
          <div className="relative">
            <button 
              ref={el => navItemsRef.current[3] = el}
              onKeyDown={(e) => handleTopLevelKeyDown(e, 3, 'skills')}
              onClick={() => {
                setOpenDropdown(openDropdown === 'skills' ? null : 'skills');
                setFocusedItemIndex(-1);
              }}
              tabIndex={focusedNavIndex === 3 ? 0 : -1}
              className="hover:text-[var(--text-primary)] transition-colors flex items-center gap-1 h-16 focus:outline-none focus:text-[var(--text-primary)]"
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
                      className={`w-full min-h-10 text-left px-4 py-2 transition-colors focus:outline-none ${selected ? 'bg-orange-500/15 font-medium text-orange-500' : ''} ${focusedItemIndex === index ? 'bg-[var(--hover-bg)] text-orange-500' : 'hover:bg-[var(--hover-bg)] hover:text-orange-500'}`}
                    >
                      {item}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <button 
            ref={el => navItemsRef.current[4] = el}
            onClick={() => {
              setOpenDropdown(null);
              setFocusedItemIndex(-1);
              onNavigate('contact');
            }}
            onKeyDown={(e) => handleTopLevelKeyDown(e, 4)}
            tabIndex={focusedNavIndex === 4 ? 0 : -1}
            className={`hover:text-[var(--text-primary)] transition-colors h-16 focus:outline-none focus:text-[var(--text-primary)] ${activeView === 'contact' ? 'text-orange-500 border-b-2 border-orange-500' : 'text-[var(--text-secondary)]'}`}
          >
            Contact Us
          </button>
        </div>

        {catalogNavFilter ? (
          <div className="min-w-0 flex-1 max-w-xl py-1 lg:max-w-2xl">{catalogNavFilter}</div>
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
          className="rounded-lg p-2 text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] hover:text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-orange-500/50"
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
        >
          {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
        </button>

        {/* Notifications */}
        <div className="relative" ref={notificationRef}>
          <button 
            type="button"
            onClick={() => {
              setMobileMenuOpen(false);
              setOpenDropdown(openDropdown === 'notifications' ? null : 'notifications');
              if (openDropdown !== 'notifications') markAllAsRead();
            }}
            className="p-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] relative focus:outline-none focus:text-[var(--text-primary)]"
          >
            <Bell size={20} />
            {unreadCount > 0 && (
              <span className="absolute top-1.5 right-1.5 w-4 h-4 bg-orange-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center border-2 border-[var(--bg-secondary)]">
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
                    className="shrink-0 text-xs font-semibold text-orange-500 transition-colors hover:text-orange-400"
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
                        className="min-w-0 flex-1 rounded-lg px-2 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-orange-500/60"
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
                          <span className="mt-1 block text-[10px] font-semibold text-orange-500">View in profile</span>
                        )}
                        {n.kind === 'broadcast' && (
                          <span className="mt-1 block text-[10px] font-semibold text-orange-500">Open course</span>
                        )}
                        {n.kind === 'generic' && n.actionLabel && (
                          <span className="mt-1 block text-[10px] font-semibold text-orange-500">{n.actionLabel}</span>
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

        {/* User Profile / Login — loading uses same footprint as avatar to avoid shifting search/notifications. */}
        <div className="relative flex h-10 shrink-0 items-center" ref={profileRef}>
          {user ? (
            <>
              <button 
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  setOpenDropdown(openDropdown === 'profile' ? null : 'profile');
                }}
                className="h-8 w-8 shrink-0 rounded-full bg-gradient-to-br from-orange-500 to-pink-500 flex items-center justify-center text-white text-xs font-bold cursor-pointer focus:outline-none focus:ring-2 focus:ring-orange-500 overflow-hidden"
              >
                <img 
                  src={user.photoURL || `https://picsum.photos/seed/${user.uid}/100/100`} 
                  alt="User" 
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                />
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
                      onClick={() => {
                        setOpenDropdown(null);
                        onNavigate('profile');
                      }}
                      className="w-full flex items-center gap-3 px-4 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--hover-bg)] transition-colors text-left"
                    >
                      <User size={16} />
                      Profile Details
                    </button>
                    {isAdmin && (
                      <button 
                        onClick={() => {
                          setOpenDropdown(null);
                          onNavigate('admin');
                        }}
                        className="w-full flex items-center gap-3 px-4 py-2 text-sm text-orange-500 hover:bg-orange-500/10 transition-colors text-left"
                      >
                        <Shield size={16} />
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
                onLogin();
              }}
              className="flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-bold rounded-md transition-colors"
            >
              <LogIn size={16} />
              Login
            </button>
          )}
        </div>

        <button
          ref={mobileMenuToggleRef}
          type="button"
          className="p-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] md:hidden"
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
            className="fixed inset-0 top-16 z-[45] bg-black/50 md:hidden"
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
            className="fixed bottom-0 left-0 top-16 z-[46] flex w-full max-w-sm flex-col overflow-y-auto overscroll-contain border-r border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-xl outline-none focus:outline-none md:hidden"
            role="dialog"
            aria-modal="true"
            aria-label="Main navigation"
          >
            <div className="border-b border-[var(--border-color)] p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">Menu</p>
            </div>
            <div className="border-b border-[var(--border-color)] px-2 py-2">
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-semibold text-[var(--text-primary)] hover:bg-[var(--hover-bg)]"
                onClick={() => onThemeToggle()}
                aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              >
                {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
                {theme === 'dark' ? 'Light mode' : 'Dark mode'}
              </button>
            </div>
            <div className="flex flex-col py-2 text-sm font-medium text-[var(--text-secondary)]">
              <button
                type="button"
                className={`px-4 py-3 text-left transition-colors hover:bg-[var(--hover-bg)] hover:text-[var(--text-primary)] ${activeView === 'catalog' ? 'text-orange-500' : ''}`}
                onClick={() => {
                  onNavigate('catalog', false);
                  setMobileMenuOpen(false);
                }}
              >
                Browse catalog
              </button>
              <div className="border-t border-[var(--border-color)]">
                <button
                  type="button"
                  className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-[var(--hover-bg)]"
                  onClick={() => setMobileNavExpand((e) => (e === 'browse' ? null : 'browse'))}
                  aria-expanded={mobileNavExpand === 'browse'}
                >
                  <span>Categories</span>
                  <ChevronDown size={16} className={`shrink-0 transition-transform ${mobileNavExpand === 'browse' ? 'rotate-180' : ''}`} />
                </button>
                {mobileNavExpand === 'browse' && (
                  <div className="border-t border-[var(--border-color)] bg-[var(--bg-primary)]/30 pb-2">
                    {browseItems.map((item) => {
                      const selected = tagIsActive(catalogActiveCategoryTags, item);
                      return (
                        <button
                          key={item}
                          type="button"
                          aria-pressed={selected}
                          className={`w-full min-h-11 px-6 py-2.5 text-left text-sm transition-colors ${selected ? 'bg-orange-500/15 font-medium text-orange-500' : 'hover:bg-[var(--hover-bg)] hover:text-orange-500'}`}
                          onClick={() => {
                            onCategorySelect(item);
                          }}
                        >
                          {item}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <div className="border-t border-[var(--border-color)]">
                <button
                  type="button"
                  className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-[var(--hover-bg)]"
                  onClick={() => setMobileNavExpand((e) => (e === 'paths' ? null : 'paths'))}
                  aria-expanded={mobileNavExpand === 'paths'}
                >
                  <span>Paths</span>
                  <ChevronDown size={16} className={`shrink-0 transition-transform ${mobileNavExpand === 'paths' ? 'rotate-180' : ''}`} />
                </button>
                {mobileNavExpand === 'paths' && (
                  <div className="border-t border-[var(--border-color)] bg-[var(--bg-primary)]/30 pb-2">
                    {learningPaths.length === 0 ? (
                      <p className="px-6 py-2.5 text-sm text-[var(--text-muted)]">No learning paths yet</p>
                    ) : (
                      learningPaths.map((path) => (
                        <button
                          key={path.id}
                          type="button"
                          className="w-full px-6 py-2.5 text-left text-sm hover:bg-[var(--hover-bg)] hover:text-orange-500"
                          onClick={() => {
                            onPathSelect(path.id);
                            setMobileMenuOpen(false);
                            setMobileNavExpand(null);
                          }}
                        >
                          {path.title || path.id}
                        </button>
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
                          className={`w-full min-h-11 px-6 py-2.5 text-left text-sm transition-colors ${selected ? 'bg-orange-500/15 font-medium text-orange-500' : 'hover:bg-[var(--hover-bg)] hover:text-orange-500'}`}
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
              {isAdmin && user && (
                <button
                  type="button"
                  className="border-t border-[var(--border-color)] px-4 py-3 text-left text-orange-500 transition-colors hover:bg-orange-500/10"
                  onClick={() => {
                    onNavigate('admin');
                    setMobileMenuOpen(false);
                  }}
                >
                  Admin
                </button>
              )}
              <button
                type="button"
                className={`border-t border-[var(--border-color)] px-4 py-3 text-left transition-colors hover:bg-[var(--hover-bg)] hover:text-[var(--text-primary)] ${activeView === 'contact' ? 'text-orange-500' : ''}`}
                onClick={() => {
                  onNavigate('contact');
                  setMobileMenuOpen(false);
                  setMobileNavExpand(null);
                }}
              >
                Contact Us
              </button>
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
