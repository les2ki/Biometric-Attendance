FACE BACKEND UPDATE - copy each file to the SAME path in your repo (overwrite), then commit and push.

NEW files:     Backend/app/services/face.py, Backend/app/routers/face.py,
               Backend/migrations/versions/f7c1a9e2d4b6_face_templates_and_commands.py,
               Backend/scripts/get_face_models.py, Backend/tests/test_face.py, Backend/.gitignore,
               Frontend/src/components/face/face-card.tsx, Frontend/src/components/face/face-verify-panel.tsx
CHANGED files: render.yaml, Backend/requirements.txt, Backend/app/main.py, Backend/app/models.py,
               Backend/app/schemas/device.py, Backend/app/routers/device.py, Backend/app/services/commands.py,
               Frontend/src/lib/types.ts, Frontend/src/lib/errors.ts, Frontend/src/components/admin/command-type-label.tsx,
               Frontend/src/app/(app)/admin/students/[id]/page.tsx, Frontend/src/app/(app)/lecturer/sessions/[id]/page.tsx
Every changed line ends in a comment containing "FACE", so you can find them.
The changed files are based on the GitHub copy from 28 Oct. If you edited one of them since, copy only the FACE lines.
face-update.patch is the same change as a git patch (git apply face-update.patch from the repo root).

Checked here: alembic upgrade/downgrade/upgrade OK, 60 backend tests pass (56 old + 4 face), dashboard type-check + lint OK.
Terminal firmware (terminal.ino) already uses this API: no reflash needed.
