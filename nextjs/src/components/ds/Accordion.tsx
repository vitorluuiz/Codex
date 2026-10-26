'use client';

import {
  createContext,
  useContext,
  useId,
  useState,
  type ReactNode,
} from 'react';

import { Icon } from '@/components/icons/Icons';
import { cx } from '@/lib/cx';
import styles from './Accordion.module.css';

export interface AccordionItemData {
  id: string;
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  badge?: ReactNode;
  disabled?: boolean;
  content: ReactNode;
  className?: string;
}

export type AccordionVariant = 'default' | 'card' | 'flush';

export interface AccordionProps {
  /** Permite múltiplos itens abertos simultaneamente ('multiple') ou apenas um ('single'). Padrão: 'single'. */
  type?: 'single' | 'multiple';
  /** ID(s) dos itens abertos inicialmente no modo descontrolado. */
  defaultValue?: string | string[];
  /** ID(s) dos itens abertos no modo controlado. */
  value?: string | string[];
  /** Callback disparado quando a seleção de itens abertos muda. */
  onValueChange?: (value: string | string[]) => void;
  /** Se true, permite fechar o item aberto no modo 'single'. Padrão: true. */
  collapsible?: boolean;
  /** Variante visual do accordion. Padrão: 'default'. */
  variant?: AccordionVariant;
  /** Itens passados como lista estruturada (alternativa a children com AccordionItem). */
  items?: AccordionItemData[];
  /** Subcomponentes AccordionItem quando usado de forma composta. */
  children?: ReactNode;
  className?: string;
  /** Rótulo acessível opcional para a região do Accordion. */
  'aria-label'?: string;
}

interface AccordionContextValue {
  type: 'single' | 'multiple';
  expandedValues: Set<string>;
  toggleItem: (id: string) => void;
  variant: AccordionVariant;
}

const AccordionContext = createContext<AccordionContextValue | null>(null);

export function Accordion({
  type = 'single',
  defaultValue,
  value: controlledValue,
  onValueChange,
  collapsible = true,
  variant = 'default',
  items,
  children,
  className,
  'aria-label': ariaLabel,
}: AccordionProps) {
  const isControlled = controlledValue !== undefined;

  const [uncontrolledValues, setUncontrolledValues] = useState<string[]>(() => {
    if (defaultValue === undefined) return [];
    return Array.isArray(defaultValue) ? defaultValue : [defaultValue];
  });

  const activeValues = isControlled
    ? Array.isArray(controlledValue)
      ? controlledValue
      : controlledValue
        ? [controlledValue]
        : []
    : uncontrolledValues;

  const expandedSet = new Set(activeValues);

  function toggleItem(id: string) {
    const isExpanded = expandedSet.has(id);
    let next: string[];

    if (type === 'single') {
      if (isExpanded) {
        next = collapsible ? [] : [id];
      } else {
        next = [id];
      }
    } else {
      if (isExpanded) {
        next = activeValues.filter((v) => v !== id);
      } else {
        next = [...activeValues, id];
      }
    }

    if (!isControlled) {
      setUncontrolledValues(next);
    }

    if (onValueChange) {
      onValueChange(type === 'single' ? (next[0] ?? '') : next);
    }
  }

  const contextValue: AccordionContextValue = {
    type,
    expandedValues: expandedSet,
    toggleItem,
    variant,
  };

  return (
    <AccordionContext.Provider value={contextValue}>
      <div
        className={cx(
          styles.accordion,
          variant === 'flush' && styles.flush,
          className,
        )}
        role="region"
        aria-label={ariaLabel}
      >
        {items
          ? items.map((item) => (
              <AccordionItem
                key={item.id}
                id={item.id}
                title={item.title}
                subtitle={item.subtitle}
                icon={item.icon}
                badge={item.badge}
                disabled={item.disabled}
                className={item.className}
              >
                {item.content}
              </AccordionItem>
            ))
          : children}
      </div>
    </AccordionContext.Provider>
  );
}

export interface AccordionItemProps {
  id: string;
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  badge?: ReactNode;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
}

export function AccordionItem({
  id,
  title,
  subtitle,
  icon,
  badge,
  disabled = false,
  children,
  className,
}: AccordionItemProps) {
  const context = useContext(AccordionContext);
  const reactId = useId();

  if (!context) {
    throw new Error('AccordionItem must be used within an <Accordion>');
  }

  const { expandedValues, toggleItem, variant } = context;
  const isExpanded = expandedValues.has(id);

  const triggerId = `accordion-trigger-${id || reactId}`;
  const panelId = `accordion-panel-${id || reactId}`;

  return (
    <div
      className={cx(
        styles.item,
        variant === 'flush' && styles.itemFlush,
        isExpanded && styles.itemExpanded,
        disabled && styles.itemDisabled,
        className,
      )}
    >
      <button
        type="button"
        id={triggerId}
        aria-expanded={isExpanded}
        aria-controls={panelId}
        disabled={disabled}
        className={styles.trigger}
        onClick={() => !disabled && toggleItem(id)}
      >
        <div className={styles.headerLeft}>
          {icon && (
            <span
              className={cx(styles.iconWrapper, isExpanded && styles.iconWrapperActive)}
              aria-hidden
            >
              {icon}
            </span>
          )}
          <div className={styles.headerContent}>
            <div className={styles.titleRow}>
              <span className={styles.title}>{title}</span>
              {badge}
            </div>
            {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
          </div>
        </div>
        <div className={styles.headerRight}>
          <span
            className={cx(styles.chevron, isExpanded && styles.chevronExpanded)}
            aria-hidden
          >
            <Icon.ChevronDown size={18} />
          </span>
        </div>
      </button>

      <div
        id={panelId}
        role="region"
        aria-labelledby={triggerId}
        className={cx(styles.panel, isExpanded && styles.panelExpanded)}
      >
        <div className={styles.panelInner}>
          <div className={styles.panelContent}>{children}</div>
        </div>
      </div>
    </div>
  );
}
