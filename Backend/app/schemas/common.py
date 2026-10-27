from typing import Generic, TypeVar  # generic page wrapper

from pydantic import BaseModel  # response base class

T = TypeVar("T")  # the item type inside a page


class Page(BaseModel, Generic[T]):  # one page of a list endpoint
    items: list[T]  # rows on this page
    total: int  # rows matching the filter (all pages)
