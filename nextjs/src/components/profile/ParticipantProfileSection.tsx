'use client';

import { Icon } from '@/components/icons/Icons';
import { KIND_META } from '@/components/set-editor/phaseKinds';
import type { ParticipantProfileData } from './participantMock';
import styles from './ParticipantProfileSection.module.css';

interface ParticipantProfileSectionProps {
  data: ParticipantProfileData;
}

export function ParticipantProfileSection({ data }: ParticipantProfileSectionProps) {
  return (
    <div className={styles.wrap}>
      <div className={styles.topGrid}>
        <div className={styles.streakCard}>
          <span className={styles.streakLabel}>Sequência atual</span>
          <div className={styles.streakValue}>
            <span className={styles.streakNumber}>{data.streakDays}</span>
            <span className={styles.streakText}>dias seguidos praticando</span>
          </div>
          <div className={styles.streakWeek}>
            {data.streakWeek.map((day, index) => (
              <div key={index} className={styles.streakDay}>
                <span className={styles.streakDot} data-done={day.done}>
                  <Icon.Sparkle size={16} />
                </span>
                <span className={styles.streakDayLabel}>{day.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className={styles.statsGrid}>
          {data.playerStats.map((stat) => (
            <div key={stat.label} className={styles.statTile}>
              <span className={styles.statTileLabel}>{stat.label}</span>
              <span className={styles.statTileValue}>{stat.value}</span>
            </div>
          ))}
        </div>
      </div>

      <section className={styles.section}>
        <h2 className={styles.title}>Desempenho por tipo de desafio</h2>
        <div className={styles.typeGrid}>
          {data.typeStats.map((stat) => {
            const meta = KIND_META[stat.kind];
            return (
              <div key={stat.kind} className={styles.typeCard}>
                <div className={styles.typeHead}>
                  <span className={styles.typeIcon} style={{ color: meta.color }}>
                    {meta.icon}
                  </span>
                  <div>
                    <div className={styles.typeLabel}>{meta.label}</div>
                    <div className={styles.typeMeta}>{stat.solved} resolvidos</div>
                  </div>
                </div>
                <div className={styles.typeBarRow}>
                  <span>Taxa de acerto</span>
                  <span style={{ color: meta.color }}>{stat.accuracy}%</span>
                </div>
                <div className={styles.typeBarTrack}>
                  <div
                    className={styles.typeBarFill}
                    style={{ width: `${stat.accuracy}%`, background: meta.color }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.title}>Praticados recentemente</h2>
        <div className={styles.practicedList}>
          {data.practicedList.map((entry) => {
            const meta = KIND_META[entry.kind];
            return (
              <div key={entry.id} className={styles.practicedRow}>
                <span className={styles.typeIcon} style={{ color: meta.color }}>
                  {meta.icon}
                </span>
                <div className={styles.practicedIdentity}>
                  <span className={styles.practicedTitle}>{entry.title}</span>
                  <span className={styles.practicedMeta}>
                    {entry.typeLabel} · {entry.dateLabel}
                  </span>
                </div>
                <div className={styles.practicedStat}>
                  <span className={styles.practicedStatValue}>{entry.phaseCount}</span>
                  <span className={styles.practicedStatLabel}>Fases</span>
                </div>
                <div className={styles.practicedStat}>
                  <span className={`${styles.practicedStatValue} ${styles.practicedScore}`}>
                    {entry.score} pts
                  </span>
                  <span className={styles.practicedStatLabel}>Pontuação</span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.title}>Conquistas</h2>
          <span className={styles.achievementsCount}>
            {data.achievementsUnlocked} de {data.achievementsTotal} desbloqueadas
          </span>
        </div>
        <div className={styles.achievementsGrid}>
          {data.achievementsList.map((achievement) => (
            <div
              key={achievement.id}
              className={styles.achievementCard}
              data-locked={!achievement.unlocked}
            >
              <span className={styles.achievementIcon}>
                <Icon.Award size={20} />
              </span>
              <div>
                <div className={styles.achievementTitle}>{achievement.title}</div>
                <div className={styles.achievementDescription}>{achievement.description}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.title}>Salas em que participei</h2>
        <div className={styles.roomList}>
          {data.roomHistory.map((room) => (
            <div key={room.id} className={styles.roomRow}>
              <div className={styles.roomIdentity}>
                <span className={styles.practicedTitle}>{room.setTitle}</span>
                <span className={styles.practicedMeta}>
                  {room.dateLabel} · {room.hostName}
                </span>
              </div>
              <div className={styles.sparkline}>
                {room.phaseAccuracy.map((value, index) => (
                  <div
                    key={index}
                    className={styles.sparklineBar}
                    style={{
                      height: `${Math.max(value, 8)}%`,
                      background: value >= 75 ? 'var(--accent-success)' : value >= 50 ? 'var(--accent-streak)' : 'var(--accent-danger)',
                    }}
                  />
                ))}
              </div>
              <div className={styles.roomRank}>
                <span className={styles.roomRankLabel}>{room.rankLabel}</span>
                <span className={styles.roomRankMeta}>
                  {room.score} pontos · {room.accuracy}%
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
