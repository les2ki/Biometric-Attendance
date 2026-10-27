import argparse  # --email / --name options
import getpass  # hidden password prompt (never a CLI argument)
import sys  # exit codes

from sqlalchemy import func, select  # queries

from app.auth import hash_password  # argon2 hashing
from app.db import SessionLocal  # direct DB session (no FastAPI here)
from app.models import Role, User  # accounts table
from app.services.audit import write_audit  # audit trail


def main() -> None:  # create the first (or another) admin account
    parser = argparse.ArgumentParser(description="Create an admin account")  # usage text
    parser.add_argument("--email", required=True)  # login name
    parser.add_argument("--name", required=True)  # display name
    args = parser.parse_args()  # read the options
    email = args.email.strip().lower()  # emails stored lower-case
    with SessionLocal() as db:  # one session
        if db.scalars(select(User).where(func.lower(User.email) == email)).first():  # already exists
            sys.exit(f"A user with email {email} already exists.")  # clear message, non-zero exit
        password = getpass.getpass("Password (min 8 chars): ")  # hidden input
        if len(password) < 8:  # too short
            sys.exit("Password must be at least 8 characters.")  # stop
        if getpass.getpass("Repeat password: ") != password:  # typo check
            sys.exit("Passwords do not match.")  # stop
        user = User(email=email, full_name=args.name.strip(), role=Role.admin, password_hash=hash_password(password), is_active=True)  # new admin
        db.add(user)  # queue insert
        db.flush()  # get user.id
        write_audit(db, actor=None, action="user.created", entity="users", entity_id=user.id, details={"role": "admin", "via": "create_admin"})  # audit (system actor)
        db.commit()  # user + audit together
        print(f"Admin {email} created (id {user.id}).")  # confirmation


if __name__ == "__main__":  # only when run directly
    main()  # do it
