from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware  # lets the Next.js dashboard call the API from the browser
from importlib import import_module

# Resolve the router module from this package.
device = import_module(".routers.device", package=__package__)
auth = import_module(".routers.auth", package=__package__)  # /auth login + me
admin_users = import_module(".routers.admin_users", package=__package__)  # /admin/users
admin_students = import_module(".routers.admin_students", package=__package__)  # /admin/students
admin_courses = import_module(".routers.admin_courses", package=__package__)  # /admin/courses
admin_devices = import_module(".routers.admin_devices", package=__package__)  # /admin/devices + /admin/commands
admin_audit = import_module(".routers.admin_audit", package=__package__)  # /admin/audit (read-only)
lecturer = import_module(".routers.lecturer", package=__package__)  # /lecturer
config = import_module(".config", package=__package__)  # settings.cors_origins



app = FastAPI(title="Biometric Attendance API")
app.add_middleware(CORSMiddleware, allow_origins=config.settings.cors_origins, allow_methods=["*"], allow_headers=["Authorization", "Content-Type"], allow_credentials=False, expose_headers=["Content-Disposition"])  # Content-Disposition exposed so the dashboard can read the CSV filename


@app.get("/")
def root() -> dict[str, str]:
    return {
        "message": "Biometric Attendance API is running",
        "docs": "/docs",
        "health": "/health",
    }


@app.get("/health")
def health() -> str:
    return "ok"
app.include_router(device.router) 
app.include_router(auth.router)  # tag: auth
app.include_router(admin_users.router)  # tag: admin
app.include_router(admin_students.router)  # tag: admin
app.include_router(admin_courses.router)  # tag: admin
app.include_router(admin_devices.router)  # tag: admin
app.include_router(admin_audit.router)  # tag: admin
app.include_router(lecturer.router)  # tag: lecturer
