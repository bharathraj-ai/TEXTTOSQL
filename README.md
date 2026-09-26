# Natural Language → SQL

## Overview

A full-stack application that converts natural-language questions into PostgreSQL SQL queries and returns real database results. Type a question in plain English — get data back instantly.

## Architecture

```
React (Vite)
    ↓
Express API (POST /api/query)
    ↓
NL → SQL Engine
    ↓
SQL Validator
    ↓
PostgreSQL (Neon)
    ↓
Result
    ↓
React Table
```

## Technology Stack

| Layer    | Technology               |
|----------|--------------------------|
| Frontend | React, Vite, JavaScript  |
| Backend  | Node.js, Express.js      |
| Database | PostgreSQL (Neon cloud)   |
| DB Driver| pg                       |
| NL→SQL   | Rule-based pattern engine |

## Project Structure

```
texttosql/
├── frontend/              # React + Vite UI
│   └── src/
│       ├── components/
│       │   ├── QueryInput.jsx
│       │   ├── SqlDisplay.jsx
│       │   └── ResultTable.jsx
│       ├── App.jsx
│       ├── main.jsx
│       └── index.css
├── backend/               # Express API
│   └── src/
│       ├── routes/queryRoutes.js
│       ├── services/
│       │   ├── llmService.js    # NL → SQL engine
│       │   └── sqlService.js    # SQL execution
│       ├── db/database.js       # PostgreSQL pool
│       ├── utils/sqlValidator.js
│       └── server.js
└── database/              # Schema + seed data
    ├── schema.sql
    └── seed.sql
```

## Database Setup

The database uses 3 tables:
- **students** (20 rows) — id, name, department, age, mark
- **courses** (8 rows) — id, course_name, department, credits
- **enrollments** (30 rows) — student_id → students, course_id → courses, grade

```bash
# Run schema
psql $DATABASE_URL -f database/schema.sql

# Load seed data
psql $DATABASE_URL -f database/seed.sql
```

## Environment Variables

Copy the example and fill in your values:

```bash
cp backend/.env.example backend/.env
```

| Variable      | Description                    |
|---------------|--------------------------------|
| `PORT`        | Backend port (default: 5000)   |
| `DATABASE_URL`| PostgreSQL connection string   |
| `LLM_API_KEY` | (Optional) For future LLM API |

## Running Backend

```bash
cd backend
npm install
npm run dev
# → http://localhost:5000
```

## Running Frontend

```bash
cd frontend
npm install
npm run dev
# → http://localhost:5173
```

## Example Queries

| Question                                    | SQL Generated                                        |
|---------------------------------------------|------------------------------------------------------|
| Show all students                           | `SELECT * FROM students;`                            |
| Show students with marks above 80           | `SELECT * FROM students WHERE mark > 80;`            |
| How many students are there?                | `SELECT COUNT(*) AS count FROM students;`            |
| Who has the highest mark?                   | `SELECT * FROM students ORDER BY mark DESC LIMIT 1;` |
| What is the average mark?                   | `SELECT ROUND(AVG(mark), 2) AS average_mark ...`     |
| Show students from CSE                      | `SELECT * FROM students WHERE department = 'CSE';`   |
| Show names ordered by mark descending       | `SELECT name, mark FROM students ORDER BY mark DESC;`|
| Show students enrolled in each course       | 3-way JOIN across enrollments, students, courses     |

## Security

- **SQL Validator** blocks `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `TRUNCATE`, `CREATE`, `GRANT`, `REVOKE`
- Only `SELECT` queries are allowed
- Multi-statement injection (`SELECT ...; DROP TABLE ...;`) is rejected
- Mutation requests are caught at the NL level before SQL generation
- Database credentials are never exposed to the frontend

## Future Improvements

- [ ] Integrate LLM API (OpenAI/Gemini) for more flexible NL understanding
- [ ] Authentication (JWT)
- [ ] Query history
- [ ] Charts and visualizations
- [ ] Docker deployment
- [ ] Rate limiting
- [ ] Query caching (Redis)
- [ ] Multiple database support
