import React, { useState, useRef, useEffect } from 'react';
import { Search, Menu, User, Bell, ChevronDown, X, LogOut, Settings, Moon, Sun, BellRing, LogIn } from 'lucide-react';
import { User as FirebaseUser } from '../firebase';

export interface NavbarNotification {
  id: string;
  message: string;
  read: boolean;
  time: string;
  kind?: 'certificate' | 'generic';
  courseId?: string;
}

interface NavbarProps {
  onNavigate: (view: 'home' | 'catalog' | 'contact' | 'profile' | 'settings', clear?: boolean) => void;
  activeView: string;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onCategorySelect: (category: string) => void;
  onPathSelect: (path: string) => void;
  onSkillSelect: (skill: string) => void;
  onClearFilters: () => void;
  theme: 'dark' | 'light';
  onThemeToggle: () => void;
  user: FirebaseUser | null;
  onLogin: () => void;
  onLogout: () => void;
  notifications: NavbarNotification[];
  setNotifications: React.Dispatch<React.SetStateAction<NavbarNotification[]>>;
  /** Certificate notifications: open profile → Completed Courses (latest first). */
  onCertificateNotificationClick: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ 
  onNavigate, 
  activeView,
  searchQuery, 
  onSearchChange, 
  onCategorySelect,
  onPathSelect,
  onSkillSelect,
  onClearFilters,
  theme,
  onThemeToggle,
  user,
  onLogin,
  onLogout,
  notifications,
  setNotifications,
  onCertificateNotificationClick,
}) => {
  const [openDropdown, setOpenDropdown] = useState<'browse' | 'paths' | 'skills' | 'profile' | 'notifications' | null>(null);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileNavExpand, setMobileNavExpand] = useState<'browse' | 'paths' | 'skills' | null>(null);
  const [focusedItemIndex, setFocusedItemIndex] = useState(-1);
  const [focusedNavIndex, setFocusedNavIndex] = useState(0);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  const notificationRef = useRef<HTMLDivElement>(null);
  const mobileSearchPanelRef = useRef<HTMLDivElement>(null);
  const mobileSearchToggleRef = useRef<HTMLButtonElement>(null);
  const mobileSearchInputRef = useRef<HTMLInputElement>(null);
  const mobileMenuRef = useRef<HTMLDivElement>(null);
  const mobileMenuToggleRef = useRef<HTMLButtonElement>(null);
  const navItemsRef = useRef<(HTMLButtonElement | null)[]>([]);

  const unreadCount = notifications.filter(n => !n.read).length;

  const browseItems = ['Software Development', 'Cloud Computing', 'Data Science', 'Cybersecurity', 'AI & ML', 'Business', 'Design'];
  const pathItems = ['Web Development', 'Mobile Development', 'Data Engineering', 'DevOps', 'Machine Learning'];
  const skillItems = ['React', 'TypeScript', 'Node.js', 'Python', 'Docker', 'Kubernetes', 'AWS'];

  const getItems = () => {
    if (openDropdown === 'browse') return browseItems;
    if (openDropdown === 'paths') return pathItems;
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
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (dropdownRef.current && !dropdownRef.current.contains(target) &&
          profileRef.current && !profileRef.current.contains(target) &&
          notificationRef.current && !notificationRef.current.contains(target)) {
        setOpenDropdown(null);
        setFocusedItemIndex(-1);
      }
      if (
        mobileSearchOpen &&
        mobileSearchPanelRef.current &&
        !mobileSearchPanelRef.current.contains(target) &&
        mobileSearchToggleRef.current &&
        !mobileSearchToggleRef.current.contains(target)
      ) {
        setMobileSearchOpen(false);
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
  }, [mobileSearchOpen, mobileMenuOpen]);

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
        return;
      }
      if (mobileSearchOpen) {
        e.preventDefault();
        setMobileSearchOpen(false);
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [openDropdown, mobileMenuOpen, mobileSearchOpen]);

  useEffect(() => {
    if (!mobileSearchOpen) return;
    const id = requestAnimationFrame(() => mobileSearchInputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [mobileSearchOpen]);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const onChange = () => {
      if (mq.matches) setMobileSearchOpen(false);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

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

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileMenuOpen]);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileMenuOpen]);

  const markAllAsRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  };

  const removeNotification = (id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  const clearAllNotifications = () => {
    setNotifications([]);
  };

  const handleTopLevelKeyDown = (e: React.KeyboardEvent, index: number, type?: 'browse' | 'paths' | 'skills' | 'profile' | 'notifications') => {
    // If dropdown is open, handle vertical navigation
    if (openDropdown === type && type) {
      const items = getItems();
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

  return (
    <nav className="fixed top-0 left-0 right-0 h-16 bg-[var(--bg-secondary)] border-b border-[var(--border-color)] flex items-center justify-between px-6 z-50 transition-colors duration-300 overflow-visible">
      <div className="flex items-center gap-8">
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
              ref={el => navItemsRef.current[1] = el}
              onClick={() => onNavigate('catalog', false)}
              onKeyDown={(e) => handleTopLevelKeyDown(e, 1, 'browse')}
              onMouseEnter={() => setOpenDropdown('browse')}
              tabIndex={focusedNavIndex === 1 ? 0 : -1}
              className={`hover:text-[var(--text-primary)] transition-colors flex items-center gap-1 h-16 focus:outline-none focus:text-[var(--text-primary)] ${activeView === 'catalog' ? 'text-orange-500 border-b-2 border-orange-500' : 'text-[var(--text-secondary)]'}`}
            >
              Browse <ChevronDown size={14} className={`${openDropdown === 'browse' ? 'rotate-180' : ''} transition-transform`} />
            </button>
            {openDropdown === 'browse' && (
              <div 
                className="absolute top-full left-0 w-56 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-b-lg shadow-xl py-2 z-50"
              >
                {browseItems.map((item, index) => (
                  <button
                    key={item}
                    onClick={() => handleItemSelect(item)}
                    onMouseEnter={() => setFocusedItemIndex(index)}
                    className={`w-full text-left px-4 py-2 transition-colors focus:outline-none ${focusedItemIndex === index ? 'bg-[var(--hover-bg)] text-orange-500' : 'hover:bg-[var(--hover-bg)] hover:text-orange-500'}`}
                  >
                    {item}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Paths Dropdown */}
          <div className="relative">
            <button 
              ref={el => navItemsRef.current[2] = el}
              onKeyDown={(e) => handleTopLevelKeyDown(e, 2, 'paths')}
              onMouseEnter={() => setOpenDropdown('paths')}
              tabIndex={focusedNavIndex === 2 ? 0 : -1}
              className="hover:text-[var(--text-primary)] transition-colors flex items-center gap-1 h-16 focus:outline-none focus:text-[var(--text-primary)]"
            >
              Paths <ChevronDown size={14} className={`${openDropdown === 'paths' ? 'rotate-180' : ''} transition-transform`} />
            </button>
            {openDropdown === 'paths' && (
              <div 
                className="absolute top-full left-0 w-56 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-b-lg shadow-xl py-2 z-50"
              >
                {pathItems.map((item, index) => (
                  <button
                    key={item}
                    onClick={() => handleItemSelect(item)}
                    onMouseEnter={() => setFocusedItemIndex(index)}
                    className={`w-full text-left px-4 py-2 transition-colors focus:outline-none ${focusedItemIndex === index ? 'bg-[var(--hover-bg)] text-orange-500' : 'hover:bg-[var(--hover-bg)] hover:text-orange-500'}`}
                  >
                    {item}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Skills Dropdown */}
          <div className="relative">
            <button 
              ref={el => navItemsRef.current[3] = el}
              onKeyDown={(e) => handleTopLevelKeyDown(e, 3, 'skills')}
              onMouseEnter={() => setOpenDropdown('skills')}
              tabIndex={focusedNavIndex === 3 ? 0 : -1}
              className="hover:text-[var(--text-primary)] transition-colors flex items-center gap-1 h-16 focus:outline-none focus:text-[var(--text-primary)]"
            >
              Skills <ChevronDown size={14} className={`${openDropdown === 'skills' ? 'rotate-180' : ''} transition-transform`} />
            </button>
            {openDropdown === 'skills' && (
              <div 
                className="absolute top-full left-0 w-56 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-b-lg shadow-xl py-2 z-50"
              >
                {skillItems.map((item, index) => (
                  <button
                    key={item}
                    onClick={() => handleItemSelect(item)}
                    onMouseEnter={() => setFocusedItemIndex(index)}
                    className={`w-full text-left px-4 py-2 transition-colors focus:outline-none ${focusedItemIndex === index ? 'bg-[var(--hover-bg)] text-orange-500' : 'hover:bg-[var(--hover-bg)] hover:text-orange-500'}`}
                  >
                    {item}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button 
            ref={el => navItemsRef.current[4] = el}
            onClick={() => onNavigate('contact')}
            onKeyDown={(e) => handleTopLevelKeyDown(e, 4)}
            tabIndex={focusedNavIndex === 4 ? 0 : -1}
            className={`hover:text-[var(--text-primary)] transition-colors h-16 focus:outline-none focus:text-[var(--text-primary)] ${activeView === 'contact' ? 'text-orange-500 border-b-2 border-orange-500' : 'text-[var(--text-secondary)]'}`}
          >
            Contact Us
          </button>
        </div>
      </div>

      <div className="flex-1 max-w-xl px-8 hidden lg:block">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" size={18} />
          <input 
            type="text" 
            placeholder="What do you want to learn?"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-md py-2 pl-10 pr-10 text-sm text-[var(--text-primary)] focus:outline-none focus:border-orange-500/50 transition-colors"
          />
          {searchQuery && (
            <button 
              type="button"
              onClick={onClearFilters}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      <div
        id="mobile-search-panel"
        ref={mobileSearchPanelRef}
        className={`lg:hidden fixed top-16 left-0 right-0 z-40 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] px-4 py-3 shadow-lg ${mobileSearchOpen ? 'block' : 'hidden'}`}
        role="search"
      >
        <div className="relative max-w-xl mx-auto">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" size={18} />
          <input
            ref={mobileSearchInputRef}
            type="search"
            enterKeyHint="search"
            placeholder="What do you want to learn?"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                setMobileSearchOpen(false);
              }
            }}
            className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-md py-2.5 pl-10 pr-10 text-sm text-[var(--text-primary)] focus:outline-none focus:border-orange-500/50 transition-colors"
            aria-label="Search courses"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => {
                onClearFilters();
                setMobileSearchOpen(false);
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
              aria-label="Clear search"
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-4">
        <button
          ref={mobileSearchToggleRef}
          type="button"
          className="p-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] lg:hidden"
          onClick={() => {
            setMobileSearchOpen((open) => !open);
            setMobileMenuOpen(false);
            setOpenDropdown(null);
          }}
          aria-expanded={mobileSearchOpen}
          aria-controls="mobile-search-panel"
          aria-label={mobileSearchOpen ? 'Close search' : 'Open search'}
        >
          {mobileSearchOpen ? <X size={20} /> : <Search size={20} />}
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
                          if (n.kind === 'certificate') {
                            onCertificateNotificationClick();
                            setOpenDropdown(null);
                          }
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

        {/* User Profile / Login */}
        <div className="relative" ref={profileRef}>
          {user ? (
            <>
              <button 
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  setOpenDropdown(openDropdown === 'profile' ? null : 'profile');
                }}
                className="h-8 w-8 rounded-full bg-gradient-to-br from-orange-500 to-pink-500 flex items-center justify-center text-white text-xs font-bold cursor-pointer focus:outline-none focus:ring-2 focus:ring-orange-500 overflow-hidden"
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
                    <button 
                      onClick={() => {
                        setOpenDropdown(null);
                        onNavigate('settings');
                      }}
                      className="w-full flex items-center gap-3 px-4 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--hover-bg)] transition-colors text-left"
                    >
                      <Settings size={16} />
                      Preferences
                    </button>
                    <button 
                      onClick={onThemeToggle}
                      className="w-full flex items-center justify-between px-4 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--hover-bg)] transition-colors text-left"
                    >
                      <div className="flex items-center gap-3">
                        {theme === 'dark' ? <Moon size={16} /> : <Sun size={16} />}
                        Theme: {theme === 'dark' ? 'Dark' : 'Light'}
                      </div>
                      <div className={`w-8 h-4 rounded-full relative transition-colors ${theme === 'dark' ? 'bg-orange-500' : 'bg-gray-600'}`}>
                        <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all ${theme === 'dark' ? 'right-0.5' : 'left-0.5'}`} />
                      </div>
                    </button>
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
            setMobileSearchOpen(false);
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
            onClick={() => setMobileMenuOpen(false)}
          />
          <div
            id="mobile-nav-drawer"
            ref={mobileMenuRef}
            className="fixed bottom-0 left-0 top-16 z-[46] flex w-full max-w-sm flex-col overflow-y-auto overscroll-contain border-r border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-xl md:hidden"
            role="dialog"
            aria-modal="true"
            aria-label="Main navigation"
          >
            <div className="border-b border-[var(--border-color)] p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">Menu</p>
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
                    {browseItems.map((item) => (
                      <button
                        key={item}
                        type="button"
                        className="w-full px-6 py-2.5 text-left text-sm hover:bg-[var(--hover-bg)] hover:text-orange-500"
                        onClick={() => {
                          onCategorySelect(item);
                          setMobileMenuOpen(false);
                          setMobileNavExpand(null);
                        }}
                      >
                        {item}
                      </button>
                    ))}
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
                    {pathItems.map((item) => (
                      <button
                        key={item}
                        type="button"
                        className="w-full px-6 py-2.5 text-left text-sm hover:bg-[var(--hover-bg)] hover:text-orange-500"
                        onClick={() => {
                          onPathSelect(item);
                          setMobileMenuOpen(false);
                          setMobileNavExpand(null);
                        }}
                      >
                        {item}
                      </button>
                    ))}
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
                    {skillItems.map((item) => (
                      <button
                        key={item}
                        type="button"
                        className="w-full px-6 py-2.5 text-left text-sm hover:bg-[var(--hover-bg)] hover:text-orange-500"
                        onClick={() => {
                          onSkillSelect(item);
                          setMobileMenuOpen(false);
                          setMobileNavExpand(null);
                        }}
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button
                type="button"
                className={`border-t border-[var(--border-color)] px-4 py-3 text-left transition-colors hover:bg-[var(--hover-bg)] hover:text-[var(--text-primary)] ${activeView === 'contact' ? 'text-orange-500' : ''}`}
                onClick={() => {
                  onNavigate('contact');
                  setMobileMenuOpen(false);
                }}
              >
                Contact Us
              </button>
            </div>
          </div>
        </>
      )}
    </nav>
  );
};
