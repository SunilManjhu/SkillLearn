export interface Lesson {
  id: string;
  title: string;
  /** Omit for YouTube lessons when using Data API / player-resolved length. */
  duration?: string;
  videoUrl: string;
  /** Shown under the player; updates per lesson. Omit for a short auto-generated blurb. */
  about?: string;
}

export interface Module {
  id: string;
  title: string;
  lessons: Lesson[];
}

export interface Course {
  id: string;
  title: string;
  author: string;
  authorBio?: string;
  thumbnail: string;
  description: string;
  level: 'Beginner' | 'Intermediate' | 'Advanced';
  duration: string;
  rating: number;
  category: string;
  modules: Module[];
}

export const COURSES: Course[] = [
  {
    id: 'python-mastery',
    title: 'Python Programming Mastery',
    author: 'SkillStream Academy',
    authorBio: 'SkillStream Academy is a leading online learning platform dedicated to providing high-quality, accessible education in technology and software development. Our mission is to empower learners worldwide by curating the best educational content from across the web into structured, easy-to-follow learning paths.',
    thumbnail: 'https://picsum.photos/seed/python-course/800/450',
    description: 'A comprehensive guide to Python programming, from basics to advanced concepts, using the best resources from across the web.',
    level: 'Beginner',
    duration: '12h 45m',
    rating: 4.9,
    category: 'Software Development',
    modules: [
      {
        id: 'm1',
        title: '01 - Course Introduction',
        lessons: [
          { 
            id: 'py-l1', 
            title: 'What is Python?', 
            videoUrl: 'https://www.youtube.com/watch?v=Y8Tko2YC5hA',
            about: 'An overview of what Python is, why it is so popular, and what you can build with it.'
          },
          { 
            id: 'py-l2', 
            title: 'History of Python', 
            videoUrl: 'https://www.youtube.com/watch?v=vLqTf2b6GZw',
            about: 'Learn about the origins of Python, created by Guido van Rossum, and its evolution over the decades.'
          },
        ]
      },
      {
        id: 'm2',
        title: '02 - Setting up the Environment',
        lessons: [
          { 
            id: 'py-l3', 
            title: 'Online IDE (Replit)', 
            videoUrl: 'https://www.youtube.com/watch?v=St95nPOwsa8',
            about: 'How to get started immediately using an online IDE like Replit without installing anything.'
          },
          { 
            id: 'py-l4', 
            title: 'Offline IDE: PyCharm', 
            videoUrl: 'https://www.youtube.com/watch?v=XsL8JDkH-ec',
            about: 'A complete guide to installing and setting up PyCharm, the professional IDE for Python development.'
          },
          { 
            id: 'py-l5', 
            title: 'Offline IDE: VSCode', 
            videoUrl: 'https://www.youtube.com/watch?v=D2cwvpJSBX4',
            about: 'Setting up Visual Studio Code for Python development, including essential extensions.'
          },
        ]
      },
      {
        id: 'm3',
        title: '03 - Variables',
        lessons: [
          { 
            id: 'py-l6', 
            title: 'What are Variables?', 
            videoUrl: 'https://www.youtube.com/watch?v=mRMmlo_Uqcs',
            about: 'Understanding how variables work in Python, naming conventions, and data types.'
          },
          { 
            id: 'py-l7', 
            title: 'Variables, Assignment, and Identifiers', 
            videoUrl: 'https://www.youtube.com/watch?v=x_hpI6dO-Zs',
            about: 'Exploring basics of variables, assignment statements, and identifiers. We\'ll explain what variables are, how to store data in them using assignment, and the rules for naming your variables. Perfect for first-time programmers or anyone new to Python'
          },
        ]
      }
    ]
  },
  {
    id: 'web-dev-bootcamp',
    title: 'Modern Web Development',
    author: 'WebDev Simplified',
    authorBio: 'WebDev Simplified is focused on teaching you the most important web development skills in the shortest amount of time. We believe that learning to code should be fun and easy, and we strive to create content that is both educational and entertaining.',
    thumbnail: 'https://picsum.photos/seed/webdev/800/450',
    description: 'Learn the core pillars of web development: HTML, CSS, and JavaScript with hands-on projects.',
    level: 'Beginner',
    duration: '15h 20m',
    rating: 4.7,
    category: 'Software Development',
    modules: [
      {
        id: 'wd-m1',
        title: 'HTML & CSS Basics',
        lessons: [
          { id: 'wd-l1', title: 'HTML5 Crash Course', videoUrl: 'https://www.youtube.com/watch?v=UB1O30fR-EE' },
          { id: 'wd-l2', title: 'CSS3 Crash Course', videoUrl: 'https://www.youtube.com/watch?v=yfoY53QXEnI' },
        ]
      }
    ]
  }
];
