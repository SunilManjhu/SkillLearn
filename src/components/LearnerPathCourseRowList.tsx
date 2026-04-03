/**
 * Vertical course list for a learning path — spec: docs/learning-path-course-list.md
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Clock } from 'lucide-react';
import type { Course } from '../data/courses';
import {
  getCourseLessonProgressSummary,
  SKILLLEARN_LOCAL_LEARNER_CLEARED_EVENT,
} from '../utils/courseProgress';
import { getLearningPathCourseRowStatus, type PathOutlineRowStatus } from '../utils/pathOutlineRowStatus';
import './LearnerPathCourseRowList.css';

export type LearnerPathCourseRowListProps = {
  courseIds: readonly string[];
  catalogCourses: readonly Course[];
  progressUserId: string | null;
  progressSnapshotVersion: number;
  onOpenCourse: (course: Course) => void;
};

function statusLabel(s: PathOutlineRowStatus): string {
  if (s === 'completed') return 'Completed';
  if (s === 'in_progress') return 'In progress';
  return 'Not started';
}

function lessonCount(course: Course): number {
  return course.modules.reduce((n, m) => n + m.lessons.length, 0);
}

function LearnerPathCourseRow({
  course,
  userId,
  version,
  onOpenCourse,
}: {
  course: Course;
  userId: string | null;
  version: number;
  onOpenCourse: (course: Course) => void;
}) {
  const status = getLearningPathCourseRowStatus(course, userId);
  const summary = getCourseLessonProgressSummary(course, userId);
  const nLessons = lessonCount(course);
  const pct = status === 'completed' ? 100 : summary.percent;

  const [fillW, setFillW] = useState(0);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const id = requestAnimationFrame(() => {
      if (mounted.current) setFillW(Math.min(100, Math.max(0, pct)));
    });
    return () => {
      mounted.current = false;
      cancelAnimationFrame(id);
    };
  }, [pct, version]);

  const titleMuted = status === 'not_started';
  const metaParts = [
    `${nLessons} ${nLessons === 1 ? 'lesson' : 'lessons'}`,
    course.duration?.trim() || '—',
    course.level,
  ];

  return (
    <button type="button" className="lpcr__row" onClick={() => onOpenCourse(course)}>
      <div
        className={`lpcr__icon-wrap ${status === 'in_progress' ? 'lpcr__icon-wrap--active' : ''} ${status === 'completed' ? 'lpcr__icon-wrap--done' : ''}`}
        aria-hidden
      >
        {status === 'completed' ? (
          <Check size={20} strokeWidth={2.5} />
        ) : (
          <Clock size={20} strokeWidth={2} />
        )}
      </div>
      <div className="lpcr__body">
        <p className={`lpcr__title ${titleMuted ? 'lpcr__title--muted' : 'lpcr__title--bright'}`}>{course.title}</p>
        <p className="lpcr__meta">
          {metaParts.join(' · ')} ·{' '}
          {status === 'in_progress' ? (
            <span className="lpcr__meta-strong">{statusLabel(status)}</span>
          ) : status === 'completed' ? (
            <span className="lpcr__meta-done">{statusLabel(status)}</span>
          ) : (
            <span className="lpcr__meta-dim">{statusLabel(status)}</span>
          )}
        </p>
      </div>
      <div className="lpcr__progress">
        <div className="lpcr__track">
          <div
            className={`lpcr__fill ${status === 'completed' ? 'lpcr__fill--done' : ''}`}
            style={{ width: `${fillW}%` }}
          />
        </div>
        <span className="lpcr__pct">{pct}%</span>
      </div>
    </button>
  );
}

export function LearnerPathCourseRowList({
  courseIds,
  catalogCourses,
  progressUserId,
  progressSnapshotVersion,
  onOpenCourse,
}: LearnerPathCourseRowListProps) {
  const [storageTick, setStorageTick] = useState(0);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      const k = e.key ?? '';
      if (
        k.includes('skilllearn-progress') ||
        k.includes('skilllearn-course-completed-at') ||
        k.includes('skilllearn-course-rating') ||
        k.startsWith('skilllearn-progress:')
      ) {
        setStorageTick((t) => t + 1);
      }
    };
    const onLocalLearnerCleared = () => setStorageTick((t) => t + 1);
    window.addEventListener('storage', onStorage);
    window.addEventListener(SKILLLEARN_LOCAL_LEARNER_CLEARED_EVENT, onLocalLearnerCleared);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(SKILLLEARN_LOCAL_LEARNER_CLEARED_EVENT, onLocalLearnerCleared);
    };
  }, []);

  const version = progressSnapshotVersion + storageTick;

  const orderedCourses = useMemo(() => {
    const out: Course[] = [];
    for (const id of courseIds) {
      const c = catalogCourses.find((x) => x.id === id);
      if (c) out.push(c);
    }
    return out;
  }, [catalogCourses, courseIds]);

  if (courseIds.length > 0 && orderedCourses.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-[var(--border-color)] bg-[var(--bg-primary)]/40 px-4 py-8 text-center text-sm text-[var(--text-muted)]">
        This path lists courses that are not in the published catalog yet. They may still be drafting or
        unpublished.
      </p>
    );
  }

  if (orderedCourses.length === 0) return null;

  return (
    <div className="lpcr" role="list">
      {orderedCourses.map((course) => (
        <React.Fragment key={course.id}>
          <LearnerPathCourseRow
            course={course}
            userId={progressUserId}
            version={version}
            onOpenCourse={onOpenCourse}
          />
        </React.Fragment>
      ))}
    </div>
  );
}
