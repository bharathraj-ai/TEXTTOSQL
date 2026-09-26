-- ============================================
-- Natural Language → SQL
-- Database Schema
-- ============================================

-- Create the database (run this separately as superuser if needed):
-- CREATE DATABASE nl_sql_db;

-- Students table
CREATE TABLE IF NOT EXISTS students (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    department VARCHAR(50) NOT NULL,
    age INTEGER,
    mark DECIMAL(5,2)
);

-- Courses table
CREATE TABLE IF NOT EXISTS courses (
    id SERIAL PRIMARY KEY,
    course_name VARCHAR(100) NOT NULL,
    department VARCHAR(50) NOT NULL,
    credits INTEGER
);

-- Enrollments table (junction table linking students ↔ courses)
CREATE TABLE IF NOT EXISTS enrollments (
    id SERIAL PRIMARY KEY,
    student_id INTEGER REFERENCES students(id),
    course_id INTEGER REFERENCES courses(id),
    grade DECIMAL(5,2)
);
