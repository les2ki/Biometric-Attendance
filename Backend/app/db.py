from collections.abc import Generator  # type hint for the dependency below

from sqlalchemy import MetaData, create_engine  # type: ignore[reportMissingImports]  # engine = connection pool to Postgres
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker  # type: ignore[reportMissingImports]  # ORM building blocks

from app.config import settings  # our database URL lives here

engine = create_engine(settings.database_url, pool_pre_ping=True)  # pre_ping drops dead connections automatically
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)  # factory for DB sessions


class Base(DeclarativeBase):  # every model inherits from this
    metadata = MetaData(naming_convention={  # predictable constraint names so migrations stay stable
        "ix": "ix_%(column_0_label)s",  # index names
        "uq": "uq_%(table_name)s_%(column_0_N_name)s",  # unique names include ALL columns (avoids clashes)
        "ck": "ck_%(table_name)s_%(constraint_name)s",  # check constraint names
        "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",  # foreign key names
        "pk": "pk_%(table_name)s",  # primary key names
    })


def get_db() -> Generator[Session, None, None]:  # FastAPI dependency: one session per request
    with SessionLocal() as db:  # opens a session and always closes it, even on errors
        yield db  # hand it to the endpoint; cleanup runs after the response