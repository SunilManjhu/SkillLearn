import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';

export type QuizAttemptPerQuestion = {
  questionId: string;
  type: 'mcq' | 'freeform';
  score: number;
  correct?: boolean;
  chosenIndex?: number;
  aiFeedback?: string;
};

export async function saveQuizAttempt(params: {
  userId: string;
  courseId: string;
  lessonId: string;
  overallScore: number;
  perQuestion: QuizAttemptPerQuestion[];
}): Promise<boolean> {
  try {
    await addDoc(collection(db, 'quizAttempts'), {
      userId: params.userId,
      courseId: params.courseId,
      lessonId: params.lessonId,
      submittedAt: serverTimestamp(),
      overallScore: params.overallScore,
      perQuestion: params.perQuestion,
    });
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'quizAttempts');
    return false;
  }
}
