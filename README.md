# 💰 Finance Dashboard API

A backend system for managing financial records and providing dashboard insights.

---

## 🚀 Features

- User Authentication (JWT)
- Role-Based Access Control (ADMIN, ANALYST, VIEWER)
- Financial Records CRUD
- Record Filtering (date, type)
- Dashboard APIs:
  - Total Income / Expense / Balance
  - Category-wise breakdown
  - Monthly & Weekly trends
  - Recent activity

---

## 🛠 Tech Stack

- Node.js (Express)
- Prisma ORM
- PostgreSQL
- JWT Authentication

---

## ⚙️ Setup Instructions

```bash
git clone <repo-url>
cd backend
npm install
```

### Setup Environment
Create `.env` file:

```env
DATABASE_URL=your_database_url
JWT_ACCESS_SECRET=your_secret
JWT_REFRESH_SECRET=your_secret
```

### Run Project
```bash
npm run dev
```

---

## 📡 API Endpoints

### Auth
- POST `/api/auth/register`
- POST `/api/auth/login`
- GET `/api/auth/me`

### Records
- POST `/api/records`
- GET `/api/records`
- PATCH `/api/records/:id`
- DELETE `/api/records/:id`

### Dashboard
- GET `/api/dashboard/summary`
- GET `/api/dashboard/by-category`
- GET `/api/dashboard/trends/monthly`
- GET `/api/dashboard/trends/weekly`
- GET `/api/dashboard/recent`

---

## 🧪 API Testing

Use Postman or Swagger:

- Swagger UI: `/api-docs`
- Health check: `/health`

---

## 📌 Notes

- All protected routes require JWT token
- Dates must be in ISO format
- Soft delete is implemented

---

## 📈 Future Improvements

- Frontend dashboard (React)
- Pagination & caching
- Graph optimization
