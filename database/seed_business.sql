-- ============================================
-- Day 3 — Test Database B: Business Schema
-- ============================================
-- Run against a SEPARATE PostgreSQL database to test
-- that the AI adapts to arbitrary schemas.

-- Clear existing data if any
DROP TABLE IF EXISTS order_items CASCADE;
DROP TABLE IF EXISTS orders CASCADE;
DROP TABLE IF EXISTS products CASCADE;
DROP TABLE IF EXISTS customers CASCADE;

-- Customers table
CREATE TABLE customers (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    city VARCHAR(100),
    phone VARCHAR(20),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Products table
CREATE TABLE products (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    category VARCHAR(100),
    price DECIMAL(10, 2) NOT NULL,
    stock INTEGER DEFAULT 0
);

-- Orders table
CREATE TABLE orders (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER REFERENCES customers(id),
    order_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    total DECIMAL(10, 2),
    status VARCHAR(50) DEFAULT 'completed'
);

-- Order items (junction table)
CREATE TABLE order_items (
    id SERIAL PRIMARY KEY,
    order_id INTEGER REFERENCES orders(id),
    product_id INTEGER REFERENCES products(id),
    quantity INTEGER NOT NULL,
    unit_price DECIMAL(10, 2) NOT NULL
);

-- ── Seed Customers ────────────────────────────
INSERT INTO customers (name, email, city, phone) VALUES
('Arun Kumar',       'arun@example.com',       'Chennai',    '+91 98765 43210'),
('Priya Sharma',     'priya@example.com',      'Mumbai',     '+91 87654 32109'),
('Ravi Krishnan',    'ravi@example.com',        'Bangalore',  '+91 76543 21098'),
('Deepa Nair',       'deepa@example.com',      'Chennai',    '+91 65432 10987'),
('Karthik Rajan',    'karthik@example.com',     'Delhi',      '+91 54321 09876'),
('Sneha Reddy',      'sneha@example.com',       'Hyderabad',  '+91 43210 98765'),
('Vijay Anand',      'vijay@example.com',       'Chennai',    '+91 32109 87654'),
('Meena Sundaram',   'meena@example.com',       'Bangalore',  '+91 21098 76543'),
('Rahul Menon',      'rahul@example.com',       'Mumbai',     '+91 10987 65432'),
('Anjali Pillai',    'anjali@example.com',      'Delhi',      '+91 09876 54321');

-- ── Seed Products ─────────────────────────────
INSERT INTO products (name, category, price, stock) VALUES
('Laptop Pro 15',       'Electronics',  75000.00,  50),
('Wireless Mouse',      'Electronics',  1200.00,   200),
('USB-C Hub',           'Electronics',  3500.00,   120),
('Mechanical Keyboard', 'Electronics',  5500.00,   80),
('Monitor 27 inch',     'Electronics',  28000.00,  35),
('Desk Lamp',           'Furniture',    2200.00,   150),
('Ergonomic Chair',     'Furniture',    18000.00,  25),
('Standing Desk',       'Furniture',    32000.00,  15),
('Notebook Pack',       'Stationery',   350.00,    500),
('Premium Pen Set',     'Stationery',   850.00,    300);

-- ── Seed Orders ───────────────────────────────
INSERT INTO orders (customer_id, order_date, total, status) VALUES
(1, NOW() - INTERVAL '2 days',   78200.00, 'completed'),
(1, NOW() - INTERVAL '15 days',  29200.00, 'completed'),
(2, NOW() - INTERVAL '5 days',   75000.00, 'completed'),
(3, NOW() - INTERVAL '10 days',  6700.00,  'completed'),
(3, NOW() - INTERVAL '45 days',  18000.00, 'completed'),
(4, NOW() - INTERVAL '1 day',    1200.00,  'pending'),
(5, NOW() - INTERVAL '20 days',  32000.00, 'completed'),
(5, NOW() - INTERVAL '60 days',  75850.00, 'completed'),
(6, NOW() - INTERVAL '3 days',   5500.00,  'completed'),
(7, NOW() - INTERVAL '7 days',   2200.00,  'shipped'),
(7, NOW() - INTERVAL '30 days',  28000.00, 'completed'),
(8, NOW() - INTERVAL '12 days',  3500.00,  'completed'),
(9, NOW() - INTERVAL '8 days',   107200.00,'completed'),
(10, NOW() - INTERVAL '25 days', 850.00,   'completed'),
(2, NOW() - INTERVAL '90 days',  18350.00, 'completed');

-- ── Seed Order Items ──────────────────────────
INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES
-- Order 1: Arun - Laptop + USB-C Hub
(1, 1, 1, 75000.00),
(1, 3, 1, 3500.00),
-- Order 2: Arun - Monitor + Mouse
(2, 5, 1, 28000.00),
(2, 2, 1, 1200.00),
-- Order 3: Priya - Laptop
(3, 1, 1, 75000.00),
-- Order 4: Ravi - Keyboard + Mouse
(4, 4, 1, 5500.00),
(4, 2, 1, 1200.00),
-- Order 5: Ravi - Ergonomic Chair
(5, 7, 1, 18000.00),
-- Order 6: Deepa - Mouse
(6, 2, 1, 1200.00),
-- Order 7: Karthik - Standing Desk
(7, 8, 1, 32000.00),
-- Order 8: Karthik - Laptop + Pen Set
(8, 1, 1, 75000.00),
(8, 10, 1, 850.00),
-- Order 9: Sneha - Keyboard
(9, 4, 1, 5500.00),
-- Order 10: Vijay - Desk Lamp
(10, 6, 1, 2200.00),
-- Order 11: Vijay - Monitor
(11, 5, 1, 28000.00),
-- Order 12: Meena - USB-C Hub
(12, 3, 1, 3500.00),
-- Order 13: Rahul - Laptop + Monitor + USB-C Hub
(13, 1, 1, 75000.00),
(13, 5, 1, 28000.00),
(13, 3, 1, 3500.00),
(13, 2, 1, 1200.00),
-- Order 14: Anjali - Pen Set
(14, 10, 1, 850.00),
-- Order 15: Priya - Chair + Notebooks
(15, 7, 1, 18000.00),
(15, 9, 1, 350.00);
