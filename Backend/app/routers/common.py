from typing import Annotated, NamedTuple  # dependency typing

from fastapi import Depends, Query  # dependency + query params
from sqlalchemy import Select, func, select  # query builders
from sqlalchemy.orm import Session  # DB session type

from app.db import get_db  # per-request session

DbSession = Annotated[Session, Depends(get_db)]  # "inject a DB session"


class Paging(NamedTuple):  # limit/offset from the query string
    limit: int  # page size
    offset: int  # rows to skip


def paging(limit: Annotated[int, Query(ge=1, le=200)] = 50, offset: Annotated[int, Query(ge=0)] = 0) -> Paging:  # shared pagination params
    return Paging(limit, offset)  # bundle them


PageParams = Annotated[Paging, Depends(paging)]  # "inject pagination"


def page_rows(db: Session, stmt: Select, page: Paging) -> tuple[list, int]:  # run a filtered query as one page + total
    total = db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery()))  # rows matching the filter
    rows = list(db.scalars(stmt.limit(page.limit).offset(page.offset)))  # this page
    return rows, total  # both
