export interface StudentComment {
  id: string;
  studentId: string;
  teacherId: string;
  teacherName: string;
  comment: string;
  commentDate: string;
  readAt: number | null;
  createdAtSeconds: number;
}
