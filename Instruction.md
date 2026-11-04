# Smart Predict Studio – Setup & Usage Instructions

Welcome to **Smart Predict Studio**! The setup and execution instructions are split into two dedicated guides depending on whether you want to use the live cloud application or run it locally:

---

## 📖 Choose Your Guide

| Guide | Description | Target Use Case |
|---|---|---|
| 🌐 **[Instruction_Deployed.md](./Instruction_Deployed.md)** | **Live Cloud Deployment Guide** | Use the application online on Render right now without installing anything locally. Explains cloud cold-start procedures and online workflow. |
| 💻 **[Instruction_Local.md](./Instruction_Local.md)** | **Local Development & Setup Guide** | Step-by-step instructions from `git clone` to `uvicorn` and `npm run dev` to install and run the full stack on your machine. |

---

## Quick Reference Links

### 1. Online Deployed App
- **Backend API (Swagger Docs)**: [https://timeseries-backend-qoem.onrender.com/docs](https://timeseries-backend-qoem.onrender.com/docs)
- **Frontend Web Application**: [https://timeseries-frontend.onrender.com](https://timeseries-frontend.onrender.com)
- *See [Instruction_Deployed.md](./Instruction_Deployed.md) for the 2-step startup order to handle Render cold-starts.*

### 2. Local Setup Commands
```bash
# Clone Repository
git clone https://github.com/MRushan-Trijotech/Time-Series-System-Python-Darts-FastAPI-React.git
cd Time-Series-System-Python-Darts-FastAPI-React

# Terminal 1: Backend
cd Backend
uv venv .venv
uv sync
uv run uvicorn backend.main:app --reload --port 8000

# Terminal 2: Frontend
cd Frontend
npm install
npm run dev
```
- *See [Instruction_Local.md](./Instruction_Local.md) for full prerequisites, test suite execution, and troubleshooting FAQs.*
