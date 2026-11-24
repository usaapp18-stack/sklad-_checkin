import React, { useEffect, useRef, useState } from 'react';
import { PUBLIC_SITE_CONFIG, PublicSiteConfig, trackAnalyticsEvent } from '../../config/site';
import { navigate } from '../../utils/router';
import { BrandWord } from '../../components/common/BrandLogo';
import { GlobeCanvas } from '../../components/public/GlobeCanvas';
import { ProductShowcasePreviews } from '../../components/public/ProductShowcasePreviews';
import { PublicHeader } from '../../components/public/PublicHeader';
import { PublicFooter } from '../../components/public/PublicFooter';
import { TariffSection } from '../../components/public/TariffSection';
import { FAQ_ITEMS } from './FaqPage';
import { useApp } from '../../context/AppContext';
import warehouseAboutImg from '../../assets/images/warehouse_about_1795521157571.jpg';
import {
  ArrowRight,
  BellRing,
  Building2,
  Calendar,
  CheckCircle2,
  Lock,
  QrCode,
  ShieldCheck,
  Wallet,
} from 'lucide-react';

interface StatSpec {
  id: string;
  target: number | null;
  decimals?: number;
  suffix?: string;
  staticText?: string;
  initialText: string;
  caption: string;
}

const STATS_LIST: StatSpec[] = [
  {
    id: 'locations',
    target: 30,
    suffix: '+',
    initialText: '0+',
    caption: 'Складов и ПВЗ в одной организации на тарифе Максимум',
  },
  {
    id: 'staff',
    target: 150,
    suffix: '+',
    initialText: '0+',
    caption: 'Сотрудников в единых графиках, табелях и расчёте ФОТ',
  },
  {
    id: 'modules',
    target: 9,
    suffix: '',
    initialText: '0',
    caption: 'Рабочих модулей: от QR-проходной до ведомости в Excel',
  },
  {
    id: 'trial',
    target: 7,
    suffix: ' ДН.',
    initialText: '0 ДН.',
    caption: 'Бесплатный пробный доступ без привязки банковской карты',
  },
  {
    id: 'discipline',
    target: null,
    staticText: '1 / ДЕНЬ',
    initialText: '1 / ДЕНЬ',
    caption: 'Жёсткий контроль одного активного чекина за дату в БД',
  },
];

interface ServiceCardSpec {
  id: string;
  title: string;
  body: string;
  icon: React.ElementType;
}

const SERVICE_CARDS: ServiceCardSpec[] = [
  {
    id: 'qr-gate',
    title: 'Check-In и геозона',
    body: 'Выход на смену через QR-проходную и проверку GPS-радиуса с правилом 1 чекин за дату.',
    icon: QrCode,
  },
  {
    id: 'schedules',
    title: 'Графики и биржа подмен',
    body: 'Планирование смен по шаблонам 2/2, 3/3, 5/2, учёт пожеланий и биржа подмен с подтверждением.',
    icon: Calendar,
  },
  {
    id: 'payroll',
    title: 'Табель и расчёт ФОТ',
    body: 'Автоматический подсчёт чистых часов, перерывов, сменных и ночных ставок без ручных таблиц.',
    icon: Wallet,
  },
  {
    id: 'network',
    title: 'Контроль объектов сети',
    body: 'Единая онлайн-сводка по сети складов и ПВЗ: статусы открытия точек и дисциплина явки.',
    icon: Building2,
  },
  {
    id: 'reports',
    title: 'Отчёты и Telegram',
    body: 'Мгновенные оповещения о сменах в Telegram и выгрузка расчётной ведомости в Excel (.xlsx).',
    icon: BellRing,
  },
];

function clamp(v: number, min = 0, max = 1): number {
  return v < min ? min : v > max ? max : v;
}

function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function runGlitchReveal(el: HTMLElement | null, delayMs: number, reducedMotion: boolean, onComplete?: () => void) {
  if (!el) return;
  if (reducedMotion || typeof el.animate !== 'function') {
    el.classList.remove('kv-ent');
    el.style.opacity = '1';
    onComplete?.();
    return;
  }

  const anim = el.animate(
    [
      {
        opacity: 0,
        clipPath: 'inset(0 100% 0 0)',
        transform: 'translateX(-0.05em)',
        textShadow: '-0.12em 0 0 rgba(47,99,255,0.8), 0.07em 0 0 rgba(17,17,17,0.25)',
        offset: 0,
      },
      {
        opacity: 1,
        clipPath: 'inset(0 38% 0 0)',
        transform: 'translateX(0.035em)',
        textShadow: '0.09em 0 0 rgba(47,99,255,0.65), -0.05em 0 0 rgba(17,17,17,0.3)',
        offset: 0.3,
      },
      {
        opacity: 0.8,
        clipPath: 'inset(0 0 0 0)',
        transform: 'translateX(-0.018em)',
        textShadow: '-0.045em 0 0 rgba(47,99,255,0.55), 0.025em 0 0 rgba(17,17,17,0.2)',
        offset: 0.55,
      },
      {
        opacity: 1,
        clipPath: 'inset(0 0 0 0)',
        transform: 'translateX(0.008em)',
        textShadow: '0.015em 0 0 rgba(47,99,255,0.35), 0 0 0 transparent',
        offset: 0.78,
      },
      {
        opacity: 1,
        clipPath: 'inset(0 0 0 0)',
        transform: 'none',
        textShadow: 'none',
        offset: 1,
      },
    ],
    {
      duration: 900,
      delay: delayMs,
      easing: 'steps(14, end)',
      fill: 'backwards',
    }
  );

  anim.onfinish = () => {
    el.classList.remove('kv-ent');
    el.style.opacity = '1';
    onComplete?.();
  };
}

function runFadeUp(el: HTMLElement | null, distancePx: number, durationMs: number, delayMs: number, reducedMotion: boolean) {
  if (!el) return;
  if (reducedMotion || typeof el.animate !== 'function') {
    el.classList.remove('kv-ent');
    el.style.opacity = '1';
    return;
  }

  const anim = el.animate(
    [
      { opacity: 0, transform: `translateY(${distancePx}px)` },
      { opacity: 1, transform: 'none' },
    ],
    {
      duration: durationMs,
      delay: delayMs,
      easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)',
      fill: 'backwards',
    }
  );

  anim.onfinish = () => {
    el.classList.remove('kv-ent');
    el.style.opacity = '1';
  };
}

export const HomePage: React.FC = () => {
  const { authStatus, authSession } = useApp();
  const isAuthenticated = authStatus === 'AUTHENTICATED' && Boolean(authSession);
  const [siteConfig, setSiteConfig] = useState<PublicSiteConfig>(PUBLIC_SITE_CONFIG);

  const hwrapRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLElement>(null);
  const hfRef = useRef<HTMLDivElement>(null);
  const copyRef = useRef<HTMLDivElement>(null);
  const overlineRef = useRef<HTMLDivElement>(null);
  const ledeRef = useRef<HTMLParagraphElement>(null);
  const btnsRef = useRef<HTMLDivElement>(null);
  const hlLinesRef = useRef<(HTMLSpanElement | null)[]>([]);
  const hzRef = useRef<HTMLDivElement>(null);

  const statsSectionRef = useRef<HTMLElement>(null);
  const photoBoxRef = useRef<HTMLDivElement>(null);
  const introRef = useRef<HTMLDivElement>(null);
  const bigLinesRef = useRef<(HTMLSpanElement | null)[]>([]);
  const statLiRefs = useRef<(HTMLLIElement | null)[]>([]);
  const statNumRefs = useRef<(HTMLDivElement | null)[]>([]);

  const globeStateRef = useRef({
    edge: 1,
    heroHeight: 900,
    uv: 1,
    mPort: false,
    reducedMotion: false,
    startTime: performance.now(),
    recOverrideTime: null as number | null,
  });

  useEffect(() => {
    let cancelled = false;
    fetch('/api/v1/public/config')
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (!cancelled && data?.success && data.config) {
          setSiteConfig(prev => ({ ...prev, ...data.config }));
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    globeStateRef.current.reducedMotion = prefersReduced;
    globeStateRef.current.startTime = performance.now();

    if (!prefersReduced) {
      root.classList.add('js-anim');
    } else {
      root.classList.remove('js-anim');
      root.classList.add('anim-done');
    }

    const failsafeTimer = window.setTimeout(() => {
      root.classList.add('anim-done');
    }, 3500);

    let heroRevealDone = prefersReduced;

    const updateUnitsAndLayout = () => {
      const vw = root.clientWidth || window.innerWidth;
      const vh = root.clientHeight || window.innerHeight;
      const isShortLand = vh < 650 && vw > vh;
      const isMobilePort = vw < 768 && vh >= vw;

      root.classList.toggle('m-port', isMobilePort);
      root.classList.toggle('m-land', isShortLand);
      root.classList.toggle('sticky', !isMobilePort && !isShortLand && !prefersReduced);

      const uc = Math.min(vw / 1440, vh / 900);
      const uv = Math.max(vw / 1440, vh / 900);
      const us = Math.min(vw / 1440, (vh - 64) / 900);
      const u = isMobilePort ? vw / 375 : uc;

      root.style.setProperty('--uc', `${uc}px`);
      root.style.setProperty('--uv', `${uv}px`);
      root.style.setProperty('--us', `${us}px`);
      root.style.setProperty('--u', `${u}px`);

      globeStateRef.current.uv = uv;
      globeStateRef.current.mPort = isMobilePort;
      globeStateRef.current.heroHeight = vh;

      if (hfRef.current) {
        if (!isMobilePort) {
          hfRef.current.style.top = `${Math.max(0, (vh - 900 * uc) / 2)}px`;
        } else {
          hfRef.current.style.top = '';
        }
      }
    };

    updateUnitsAndLayout();

    // Hero entrance timeline
    if (prefersReduced) {
      document.querySelectorAll('.kv-ent').forEach(el => el.classList.remove('kv-ent'));
    } else {
      runFadeUp(overlineRef.current, 10, 700, 120, false);
      hlLinesRef.current.forEach((ln, idx) => {
        runGlitchReveal(ln, 220 + idx * 130, false, () => {
          if (idx === hlLinesRef.current.length - 1) {
            heroRevealDone = true;
          }
        });
      });
      runFadeUp(ledeRef.current, 14, 800, 820, false);
      runFadeUp(btnsRef.current, 14, 800, 960, false);
    }

    // Stats IntersectionObservers (animated count-up + photo reveal + glitch headline)
    const observers: IntersectionObserver[] = [];
    if (!prefersReduced && typeof IntersectionObserver !== 'undefined') {
      const obsOpts: IntersectionObserverInit = {
        threshold: 0,
        rootMargin: '0px 0px -10% 0px',
      };

      if (photoBoxRef.current) {
        const photoObs = new IntersectionObserver(entries => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            photoObs.disconnect();
            photoBoxRef.current?.classList.add('is-revealed');
            runFadeUp(introRef.current, 14, 900, 200, false);
          }
        }, obsOpts);
        photoObs.observe(photoBoxRef.current);
        observers.push(photoObs);
      }

      const headlineEl = statsSectionRef.current?.querySelector('.kv-big');
      if (headlineEl) {
        const hlObs = new IntersectionObserver(entries => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            hlObs.disconnect();
            bigLinesRef.current.forEach((ln, idx) => {
              runGlitchReveal(ln, idx * 130, false);
            });
          }
        }, obsOpts);
        hlObs.observe(headlineEl);
        observers.push(hlObs);
      }

      statLiRefs.current.forEach((liEl, idx) => {
        if (!liEl) return;
        const spec = STATS_LIST[idx];
        const numEl = statNumRefs.current[idx];
        if (numEl) {
          numEl.textContent = spec.initialText;
        }
        const statObs = new IntersectionObserver(entries => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            statObs.disconnect();
            runFadeUp(liEl, 12, 700, 0, false);
            runGlitchReveal(numEl, 60, false);

            if (typeof liEl.animate === 'function') {
              try {
                liEl.animate([{ '--hl': 0 } as any, { '--hl': 1 } as any], {
                  duration: 900,
                  delay: 60,
                  easing: 'cubic-bezier(0.7, 0, 0.2, 1)',
                  fill: 'backwards',
                });
              } catch {
                // ignore if custom property animation unsupported
              }
            }

            if (spec.target !== null && numEl) {
              const targetVal = spec.target;
              const startAt = performance.now();
              const dur = 1600;
              const tickCount = (ts: number) => {
                const k = clamp((ts - startAt) / dur);
                const eased = 1 - Math.pow(1 - k, 3);
                const val = targetVal * eased;
                if (spec.decimals) {
                  numEl.textContent = `${val.toFixed(spec.decimals)}${spec.suffix || ''}`;
                } else {
                  const rounded = Math.round(val);
                  const formatted =
                    rounded >= 1000
                      ? rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '\u2009')
                      : String(rounded);
                  numEl.textContent = `${formatted}${spec.suffix || ''}`;
                }
                if (k < 1) {
                  requestAnimationFrame(tickCount);
                }
              };
              requestAnimationFrame(tickCount);
            }
          }
        }, obsOpts);
        statObs.observe(liEl);
        observers.push(statObs);
      });
    } else {
      photoBoxRef.current?.classList.add('is-revealed');
      STATS_LIST.forEach((spec, idx) => {
        const numEl = statNumRefs.current[idx];
        if (!numEl) return;
        if (spec.staticText) {
          numEl.textContent = spec.staticText;
        } else if (spec.target !== null) {
          numEl.textContent = `${spec.target}${spec.suffix || ''}`;
        }
      });
    }

    const updateFrameForScroll = (scrollY: number) => {
      const vw = root.clientWidth || window.innerWidth;
      const vh = root.clientHeight || window.innerHeight;
      const hwrapH = hwrapRef.current?.offsetHeight || Math.round(1.4 * vh);
      const isSticky = root.classList.contains('sticky');

      // Horizon Glow transition between Hero and Pinned Stats (#about)
      const e = (hwrapH - scrollY) / vh - 0.42;
      globeStateRef.current.edge = e;

      const drawnEdge = e > 0.12 ? e : -0.03 + 0.15 * Math.exp((e - 0.12) / 0.15);
      const glowOpacity = 1 - easeInOutQuad(clamp((-0.12 - e) / 0.4));
      const hzEl = hzRef.current;
      if (hzEl) {
        if (glowOpacity < 0.002 || e > 1.04) {
          hzEl.style.display = 'none';
        } else {
          const Rx = Math.max(0.75 * vw, 0.9 * vh);
          const Ry = 0.72 * vh;
          const centerY = drawnEdge * vh - Ry;
          hzEl.style.display = 'block';
          hzEl.style.opacity = `${glowOpacity}`;
          hzEl.style.background = `radial-gradient(${Rx.toFixed(1)}px ${Ry.toFixed(1)}px at 50% ${centerY.toFixed(1)}px, rgba(255,255,255,0) 0px, rgba(238,242,255,0) ${(0.985 * Rx).toFixed(1)}px, rgba(214,224,255,0.6) ${(1.0 * Rx).toFixed(1)}px, #9fb2ff ${(1.06 * Rx).toFixed(1)}px, #5a80ff ${(1.14 * Rx).toFixed(1)}px, #2f63ff ${(1.236 * Rx).toFixed(1)}px, #5a80ff ${(1.32 * Rx).toFixed(1)}px, #a9bcff ${(1.42 * Rx).toFixed(1)}px, #dfe6ff ${(1.53 * Rx).toFixed(1)}px, #ffffff ${(1.65 * Rx).toFixed(1)}px)`;
        }
      }

      const heroEl = heroRef.current;
      if (heroEl) {
        heroEl.style.visibility = isSticky && e < -0.06 ? 'hidden' : 'visible';
      }

      const k = clamp((0.95 - e) / 0.42);
      if (copyRef.current) {
        copyRef.current.style.opacity = `${1 - k}`;
        copyRef.current.style.transform = `translateY(${(-5 * k).toFixed(3)}vh)`;
      }

      if (heroRevealDone) {
        const j =
          k > 0 && k < 1
            ? (((Math.floor(k * 16) * 9301 + 49297) % 233280) / 233280 - 0.5)
            : 0;
        const wipePct = (k * k * 100).toFixed(2);
        hlLinesRef.current.forEach((ln, idx) => {
          if (!ln) return;
          if (k <= 0.001) {
            ln.style.transform = '';
            ln.style.textShadow = '';
            ln.style.clipPath = '';
          } else {
            const o = j * 0.09 * (idx % 2 === 0 ? 1 : -1);
            ln.style.transform = `translateX(${o.toFixed(4)}em)`;
            ln.style.textShadow = `${(-1.6 * o).toFixed(4)}em 0 0 rgba(47,99,255,${(0.7 * k + 0.15).toFixed(3)}), ${(0.8 * o).toFixed(4)}em 0 0 rgba(17,17,17,0.25)`;
            ln.style.clipPath = `inset(0 ${wipePct}% 0 0)`;
          }
        });
      }
    };

    let rafLoopId = 0;
    const loop = () => {
      updateFrameForScroll(window.scrollY);
      rafLoopId = requestAnimationFrame(loop);
    };
    rafLoopId = requestAnimationFrame(loop);

    const onResize = () => {
      updateUnitsAndLayout();
      updateFrameForScroll(window.scrollY);
    };
    window.addEventListener('resize', onResize, { passive: true });

    return () => {
      window.clearTimeout(failsafeTimer);
      if (rafLoopId) cancelAnimationFrame(rafLoopId);
      window.removeEventListener('resize', onResize);
      observers.forEach(o => o.disconnect());
      root.classList.remove('m-port', 'm-land', 'm-hp', 'sticky', 'js-anim', 'anim-done');
      root.style.removeProperty('--uc');
      root.style.removeProperty('--uv');
      root.style.removeProperty('--us');
      root.style.removeProperty('--u');
    };
  }, []);

  const scrollToSection = (e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    e.preventDefault();
    if (id === 'top') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    const target = document.getElementById(id);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const handleRouteLink = (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    e.preventDefault();
    navigate(href);
  };

  const previewFaq = FAQ_ITEMS.slice(0, 4);

  return (
    <div className="kv-page bg-[#ffffff] text-[#111111]">
      {/* Unified Pinned Top Bar */}
      <PublicHeader
        currentPath="/"
        isAuthenticated={isAuthenticated}
        onScrollTop={e => scrollToSection(e, 'top')}
      />

      {/* SECTION 1: GLOBE HERO */}
      <div className="kv-hwrap" ref={hwrapRef}>
        <section id="top" className="kv-hero" ref={heroRef}>
          <div className="kv-gwrap">
            <GlobeCanvas stateRef={globeStateRef} />
          </div>

          <div className="kv-hf" ref={hfRef}>
            <div className="kv-copy" ref={copyRef}>
              <div className="kv-overline kv-ent" ref={overlineRef}>
                ЕДИНАЯ СЕТЬ СКЛАДОВ
              </div>

              <h1 className="kv-hl">
                <span
                  className="kv-ln kv-ent"
                  ref={el => {
                    hlLinesRef.current[0] = el;
                  }}
                >
                  КАЖДАЯ СМЕНА
                </span>
                <span
                  className="kv-ln kv-ent"
                  ref={el => {
                    hlLinesRef.current[1] = el;
                  }}
                >
                  ПОД ПОЛНЫМ
                </span>
                <span
                  className="kv-ln kv-ent"
                  ref={el => {
                    hlLinesRef.current[2] = el;
                  }}
                >
                  КОНТРОЛЕМ
                </span>
              </h1>

              <p className="kv-lede kv-ent" ref={ledeRef}>
                Графики смен, выход на объект по QR и геозоне, контроль персонала и расчёт ФОТ — в одном кабинете под одной командой.
              </p>

              <div className="kv-btns kv-ent" ref={btnsRef}>
                <a
                  href="/register"
                  onClick={e => {
                    trackAnalyticsEvent('trial_cta_click', { placement: 'hero' });
                    handleRouteLink(e, '/register');
                  }}
                  className="kv-btn-primary"
                >
                  7 ДНЕЙ БЕСПЛАТНО
                </a>
                <a
                  href="/demo"
                  onClick={e => {
                    trackAnalyticsEvent('demo_open', { from: 'hero' });
                    handleRouteLink(e, '/demo');
                  }}
                  className="kv-btn-outline"
                >
                  ОТКРЫТЬ ДЕМО
                </a>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* HORIZON GLOW TRANSITION */}
      <div className="kv-hz" ref={hzRef} aria-hidden="true" />

      {/* SECTION 2: PINNED STATS & ABOUT (#about) — Animated Numbers + Warehouse Photo */}
      <section id="about" className="kv-stats" ref={statsSectionRef}>
        <div className="kv-pin">
          <div className="kv-ph" ref={photoBoxRef}>
            <i
              style={{
                backgroundImage: `url("${warehouseAboutImg}")`,
              }}
              role="img"
              aria-label="Современный складской комплекс и рабочая зона комплектации заказов"
            />
          </div>

          <h2 className="kv-big">
            <span
              className="kv-ln kv-ent"
              ref={el => {
                bigLinesRef.current[0] = el;
              }}
            >
              КОНТРОЛЬ
            </span>
            <span
              className="kv-ln kv-ent"
              ref={el => {
                bigLinesRef.current[1] = el;
              }}
            >
              СМЕНЫ.
            </span>
            <span
              className="kv-ln kv-ent"
              ref={el => {
                bigLinesRef.current[2] = el;
              }}
            >
              ПРОЗРАЧНЫЙ
            </span>
            <span
              className="kv-ln kv-ent"
              ref={el => {
                bigLinesRef.current[3] = el;
              }}
            >
              РЕЗУЛЬТАТ.
            </span>
          </h2>
        </div>

        <div className="kv-col">
          <div className="kv-intro kv-ent" ref={introRef}>
            <p>
              Когда смены, чекины и расчёт ставок собраны в единой системе, каждый склад и пункт выдачи работает без пересчётов вручную и споров о явке.
            </p>
            <p>
              От планирования графиков и QR-проходной с GPS до готовой ведомости в Excel — <BrandWord /> объединяет все ежедневные операции в одном прозрачном контуре.
            </p>
            <div className="kv-intro-links">
              <a
                href="#services"
                onClick={e => scrollToSection(e, 'services')}
                className="kv-intro-link"
              >
                Модули системы
              </a>
              <a
                href="#tariffs"
                onClick={e => scrollToSection(e, 'tariffs')}
                className="kv-intro-link"
              >
                Калькулятор тарифов
              </a>
              <a
                href="/demo"
                onClick={e => handleRouteLink(e, '/demo')}
                className="kv-intro-link"
              >
                Демо-кабинет
              </a>
            </div>
          </div>

          <ul className="kv-nums">
            {STATS_LIST.map((stat, idx) => (
              <li
                key={stat.id}
                className="kv-stat-li kv-ent"
                ref={el => {
                  statLiRefs.current[idx] = el;
                }}
              >
                <div
                  className="kv-stat-n kv-ent"
                  ref={el => {
                    statNumRefs.current[idx] = el;
                  }}
                >
                  {stat.initialText}
                </div>
                <div className="kv-stat-c">{stat.caption}</div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* SECTION 3+: MODULES GRID, PRODUCT SHOWCASE, TARIFFS, SECURITY, FAQ & FOOTER */}
      <div className="kv-after-track">
        {/* Core Modules Grid (replaces removed forklift/container animation cleanly without white gap) */}
        <section id="services" className="py-16 sm:py-24 bg-[#fafcff] border-b border-[#e2e8f8]">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
              <div className="max-w-2xl space-y-2">
                <div className="text-xs font-bold uppercase tracking-wider text-[#2f63ff]">Модули платформы</div>
                <h2 className="text-2xl sm:text-4xl font-bold text-[#111111] tracking-tight text-balance">
                  Всё для управления персоналом склада в одной системе
                </h2>
              </div>
              <a
                href="/features"
                onClick={e => handleRouteLink(e, '/features')}
                className="text-sm font-semibold text-[#2f63ff] hover:underline whitespace-nowrap shrink-0"
              >
                Все 9 модулей подробно →
              </a>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {SERVICE_CARDS.map((card, idx) => {
                const Icon = card.icon;
                return (
                  <div
                    key={card.id}
                    className="bg-white border border-[#d9dbe0] rounded-xl p-6 flex flex-col justify-between space-y-4 hover:border-[#2f63ff] transition-all shadow-sm"
                  >
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs font-bold text-[#2f63ff]">0{idx + 1}.</span>
                        <div className="w-10 h-10 rounded-lg bg-[#f0f5ff] flex items-center justify-center text-[#2f63ff]">
                          <Icon className="w-5 h-5" />
                        </div>
                      </div>
                      <h3 className="text-lg font-bold text-[#111111]">{card.title}</h3>
                      <p className="text-sm text-[#5d6270] leading-relaxed">{card.body}</p>
                    </div>
                  </div>
                );
              })}
              <div className="bg-[#111111] text-white rounded-xl p-6 flex flex-col justify-between space-y-4 shadow-sm">
                <div className="space-y-3">
                  <span className="font-mono text-xs font-bold text-[#85a7ff]">06. ЭКСПОРТ И API</span>
                  <h3 className="text-lg font-bold text-white">Ведомости и интеграции</h3>
                  <p className="text-sm text-neutral-300 leading-relaxed">
                    Мгновенная выгрузка данных в Excel (.xlsx), защищённые сессии и полная история аудита всех действий.
                  </p>
                </div>
                <a
                  href="/features"
                  onClick={e => handleRouteLink(e, '/features')}
                  className="text-xs font-bold text-[#85a7ff] hover:text-white hover:underline inline-flex items-center gap-1"
                >
                  <span>Узнать обо всех возможностях</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* Product Screens Preview */}
        <section className="py-16 sm:py-24 bg-[#ffffff]">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
              <div className="max-w-2xl space-y-2">
                <div className="text-xs font-bold uppercase tracking-wider text-[#2f63ff]">
                  Рабочий кабинет внутри
                </div>
                <h2 className="text-2xl sm:text-4xl font-bold text-[#111111] tracking-tight text-balance">
                  Реальные экраны управления сменами и зарплатой
                </h2>
              </div>
              <a
                href="/features"
                onClick={e => handleRouteLink(e, '/features')}
                className="text-sm font-semibold text-[#2f63ff] hover:underline whitespace-nowrap shrink-0"
              >
                Все 9 модулей подробно →
              </a>
            </div>
            <ProductShowcasePreviews compact />
          </div>
        </section>

        {/* Tariffs & Period Discount Calculator */}
        <section id="tariffs" className="py-16 sm:py-24 bg-[#f7f9ff] border-y border-[#e2e8f8]">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-10">
            <div className="max-w-2xl space-y-2">
              <div className="text-xs font-bold uppercase tracking-wider text-[#2f63ff]">
                Тарифы <BrandWord />
              </div>
              <h2 className="text-2xl sm:text-4xl font-bold text-[#111111] tracking-tight text-balance">
                Выберите масштаб под вашу сеть складов
              </h2>
            </div>
            <TariffSection showComparisonTable={false} />
          </div>
        </section>

        {/* Security & Discipline */}
        <section className="py-14 bg-[#ffffff] border-b border-[#e5e7eb]">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                icon: Lock,
                title: 'Изоляция данных компаний',
                desc: 'Каждая организация работает в отдельном контуре с изоляцией складов, сотрудников, табеля и отчётов.',
              },
              {
                icon: CheckCircle2,
                title: 'Строгая целостность смен',
                desc: 'Уникальный контроль на уровне базы данных не допускает двойных чекинов за одну дату.',
              },
              {
                icon: ShieldCheck,
                title: 'Изолированный демо-контур',
                desc: 'Ознакомительное демо в браузере не смешивается с рабочими базами клиентов и не создаёт мусорных записей.',
              },
            ].map(card => {
              const Icon = card.icon;
              return (
                <div key={card.title} className="p-6 bg-[#f7f9ff] border border-[#dce4f8] rounded-lg space-y-2">
                  <Icon className="w-5 h-5 text-[#2f63ff]" />
                  <h3 className="font-bold text-base text-[#111111]">{card.title}</h3>
                  <p className="text-xs sm:text-sm text-[#5d6270] leading-relaxed">{card.desc}</p>
                </div>
              );
            })}
          </div>
        </section>

        {/* FAQ Preview & Final CTA */}
        <section className="py-16 sm:py-20 bg-[#ffffff]">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
              <div className="lg:col-span-4 space-y-3">
                <div className="text-xs font-bold uppercase tracking-wider text-[#2f63ff]">Частые вопросы</div>
                <h2 className="text-2xl font-bold text-[#111111]">Ответы перед запуском</h2>
                <p className="text-sm text-[#5d6270]">
                  Коротко о работе с несколькими складами, правилах пробного периода и сохранности данных.
                </p>
                <a
                  href="/faq"
                  onClick={e => handleRouteLink(e, '/faq')}
                  className="inline-block text-sm font-semibold text-[#2f63ff] hover:underline pt-1"
                >
                  Открыть все вопросы →
                </a>
              </div>

              <div className="lg:col-span-8 grid grid-cols-1 sm:grid-cols-2 gap-4">
                {previewFaq.map(q => (
                  <div key={q.id} className="p-5 bg-[#f7f9ff] border border-[#dce4f8] rounded-lg space-y-2">
                    <h3 className="text-sm font-bold text-[#111111]">{q.question}</h3>
                    <p className="text-xs text-[#5d6270] leading-relaxed">{q.answer}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-[#111111] text-white rounded-lg p-8 sm:p-12 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
              <div className="max-w-2xl space-y-2">
                <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
                  Запустите учёт смен и зарплаты в <BrandWord /> уже сегодня
                </h2>
                <p className="text-sm sm:text-base text-neutral-300">
                  Зарегистрируйтесь как руководитель, создайте организацию и пользуйтесь системой бесплатно 7 дней.
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-3 shrink-0">
                <a
                  href="/register"
                  onClick={e => {
                    trackAnalyticsEvent('trial_cta_click', { placement: 'final_cta' });
                    handleRouteLink(e, '/register');
                  }}
                  className="min-h-[48px] px-6 py-3 bg-[#2f63ff] hover:bg-[#1f4fe0] text-white font-semibold text-sm rounded-full inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors"
                >
                  <span>Попробовать 7 дней бесплатно</span>
                  <ArrowRight className="w-4 h-4" />
                </a>
                <a
                  href="/demo"
                  onClick={e => handleRouteLink(e, '/demo')}
                  className="min-h-[48px] px-6 py-3 bg-transparent hover:bg-white hover:text-[#111111] text-white border border-white/70 font-semibold text-sm rounded-full inline-flex items-center justify-center whitespace-nowrap transition-colors"
                >
                  Открыть демо
                </a>
              </div>
            </div>
          </div>
        </section>

        <PublicFooter
          siteConfig={siteConfig}
          isAuthenticated={isAuthenticated}
          onScrollTop={e => scrollToSection(e, 'top')}
        />
      </div>
    </div>
  );
};
