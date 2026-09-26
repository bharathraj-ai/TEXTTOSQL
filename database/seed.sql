-- ============================================
-- Natural Language → SQL
-- Seed Data
-- ============================================

-- Clear existing data (in correct order due to foreign key constraints)
TRUNCATE enrollments, courses, students RESTART IDENTITY CASCADE;

-- ──────────────────────────────────────────────
-- Students (20 students across 5 departments)
-- ──────────────────────────────────────────────
INSERT INTO students (name, department, age, mark) VALUES
('Arun Kumar',       'CSE',    20, 92.50),
('Priya Sharma',     'CSE',    21, 88.00),
('Ravi Krishnan',    'CSE',    20, 76.50),
('Deepa Nair',       'CSE',    22, 95.00),
('Karthik Rajan',    'ECE',    21, 72.00),
('Sneha Reddy',      'ECE',    20, 84.50),
('Vijay Anand',      'ECE',    22, 68.00),
('Meena Sundaram',   'MECH',   21, 79.00),
('Rahul Menon',      'MECH',   20, 55.50),
('Anjali Pillai',    'MECH',   22, 91.00),
('Suresh Babu',      'AI&DS',  20, 87.00),
('Lakshmi Devi',     'AI&DS',  21, 93.50),
('Manoj Varma',      'AI&DS',  22, 82.00),
('Divya Krishnan',   'AI&DS',  20, 78.50),
('Arjun Nambiar',    'IT',     21, 65.00),
('Kavitha Ramesh',   'IT',     20, 74.00),
('Sanjay Patel',     'IT',     22, 88.50),
('Revathi Murali',   'CSE',    21, 70.00),
('Ganesh Iyer',      'ECE',    20, 83.00),
('Pooja Venkat',     'AI&DS',  22, 90.00);

-- ──────────────────────────────────────────────
-- Courses (8 courses across departments)
-- ──────────────────────────────────────────────
INSERT INTO courses (course_name, department, credits) VALUES
('Data Structures',         'CSE',    4),
('Database Systems',        'CSE',    3),
('Digital Electronics',     'ECE',    4),
('Signal Processing',       'ECE',    3),
('Thermodynamics',          'MECH',   4),
('Machine Learning',        'AI&DS',  4),
('Web Development',         'IT',     3),
('Computer Networks',       'CSE',    3);

-- ──────────────────────────────────────────────
-- Enrollments (30 enrollments linking students ↔ courses)
-- ──────────────────────────────────────────────
INSERT INTO enrollments (student_id, course_id, grade) VALUES
-- CSE students in CSE courses
(1,  1,  90.00),   -- Arun → Data Structures
(1,  2,  88.00),   -- Arun → Database Systems
(2,  1,  85.00),   -- Priya → Data Structures
(2,  8,  82.00),   -- Priya → Computer Networks
(3,  2,  74.00),   -- Ravi → Database Systems
(4,  1,  96.00),   -- Deepa → Data Structures
(4,  2,  93.00),   -- Deepa → Database Systems
(18, 8,  68.00),   -- Revathi → Computer Networks

-- ECE students in ECE courses
(5,  3,  70.00),   -- Karthik → Digital Electronics
(5,  4,  66.00),   -- Karthik → Signal Processing
(6,  3,  82.00),   -- Sneha → Digital Electronics
(7,  4,  60.00),   -- Vijay → Signal Processing
(19, 3,  80.00),   -- Ganesh → Digital Electronics

-- MECH students in MECH courses
(8,  5,  77.00),   -- Meena → Thermodynamics
(9,  5,  52.00),   -- Rahul → Thermodynamics
(10, 5,  89.00),   -- Anjali → Thermodynamics

-- AI&DS students in AI&DS + cross-department
(11, 6,  85.00),   -- Suresh → Machine Learning
(11, 1,  80.00),   -- Suresh → Data Structures (cross-dept)
(12, 6,  95.00),   -- Lakshmi → Machine Learning
(13, 6,  78.00),   -- Manoj → Machine Learning
(13, 2,  75.00),   -- Manoj → Database Systems (cross-dept)
(14, 6,  76.00),   -- Divya → Machine Learning
(20, 6,  88.00),   -- Pooja → Machine Learning

-- IT students in IT + cross-department
(15, 7,  62.00),   -- Arjun → Web Development
(16, 7,  72.00),   -- Kavitha → Web Development
(16, 8,  70.00),   -- Kavitha → Computer Networks (cross-dept)
(17, 7,  86.00),   -- Sanjay → Web Development
(17, 1,  84.00),   -- Sanjay → Data Structures (cross-dept)

-- Additional cross-department enrollments
(1,  6,  91.00),   -- Arun → Machine Learning (cross-dept)
(6,  6,  80.00);   -- Sneha → Machine Learning (cross-dept)
