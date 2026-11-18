"""Generic Python fixture; no framework."""
from math import sqrt


def distance(x, y):
    """Return Euclidean distance from the origin."""
    return sqrt(x * x + y * y)


async def distance_async(x, y):
    return distance(x, y)
