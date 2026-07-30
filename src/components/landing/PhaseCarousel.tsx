'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { Tag } from '@/components/ds';
import { Icon } from '@/components/icons/Icons';
import { ImageSlot } from '@/components/media/ImageSlot';
import type { PhaseSlide } from '@/content/landing';
import { cssVars } from '@/lib/cssVars';
import { cx } from '@/lib/cx';
import styles from './PhaseCarousel.module.css';

const AUTOPLAY_MS = 4500;

export function PhaseCarousel({ slides }: { slides: PhaseSlide[] }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval>>(undefined);

  const goTo = useCallback((next: number) => {
    setIndex(((next % slides.length) + slides.length) % slides.length);
  }, [slides.length]);

  useEffect(() => {
    if (paused) return;
    timerRef.current = setInterval(() => setIndex((i) => (i + 1) % slides.length), AUTOPLAY_MS);
    return () => clearInterval(timerRef.current);
  }, [paused, slides.length, index]);

  return (
    <div>
      <div
        className={styles.viewport}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocusCapture={() => setPaused(true)}
        onBlurCapture={() => setPaused(false)}
        aria-roledescription="carrossel"
        aria-label="Tipos de fase"
      >
        <div className={styles.rail} style={cssVars({ '--carousel-offset': `${-index * 100}%` })}>
          {slides.map((slide, i) => (
            <div
              key={slide.id}
              className={styles.slide}
              role="group"
              aria-roledescription="slide"
              aria-label={`${i + 1} de ${slides.length}: ${slide.title}`}
              aria-hidden={i !== index}
            >
              <ImageSlot
                placeholder={slide.imagePlaceholder}
                shape="rect"
                width={640}
                height={380}
                className={styles.slideImage}
              />
              <div className={styles.slideBody}>
                <Tag tone={slide.tone}>{slide.tagLabel}</Tag>
                <h3 className={styles.slideTitle}>{slide.title}</h3>
                <p className={styles.slideText}>{slide.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className={styles.controls}>
        <button type="button" className={styles.arrow} aria-label="Anterior" onClick={() => goTo(index - 1)}>
          <Icon.ChevronLeft size={20} />
        </button>
        <div className={styles.dots}>
          {slides.map((slide, i) => (
            <button
              key={slide.id}
              type="button"
              aria-label={`Ir para ${slide.title}`}
              aria-current={i === index}
              onClick={() => goTo(i)}
              className={cx(styles.dot, i === index && styles.dotActive)}
            />
          ))}
        </div>
        <button type="button" className={styles.arrow} aria-label="Próximo" onClick={() => goTo(index + 1)}>
          <Icon.ChevronRight size={20} />
        </button>
      </div>
    </div>
  );
}
