from hmac import compare_digest

from fastapi import Depends, HTTPException, Request, Response, status
from itsdangerous import BadSignature, URLSafeSerializer

from app.config import Settings, get_settings
from app.models import AuthState, LoginRequest

COOKIE_NAME = "recipe_editor_session"


def get_serializer(settings: Settings) -> URLSafeSerializer:
    return URLSafeSerializer(settings.session_secret, salt="recipe-editor")


def current_auth_state(request: Request, settings: Settings = Depends(get_settings)) -> AuthState:
    cookie = request.cookies.get(COOKIE_NAME)
    if not cookie:
        return AuthState(authenticated=False)

    try:
        payload = get_serializer(settings).loads(cookie)
    except BadSignature:
        return AuthState(authenticated=False)

    username = payload.get("username") if isinstance(payload, dict) else None
    if username != settings.recipe_editor_username:
        return AuthState(authenticated=False)
    return AuthState(authenticated=True, username=username)


def require_editor(auth_state: AuthState = Depends(current_auth_state)) -> AuthState:
    if not auth_state.authenticated:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Editor login required"
        )
    return auth_state


def login(response: Response, payload: LoginRequest, settings: Settings) -> AuthState:
    valid_username = compare_digest(payload.username, settings.recipe_editor_username)
    valid_password = compare_digest(payload.password, settings.recipe_editor_password)
    if not (valid_username and valid_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    token = get_serializer(settings).dumps({"username": payload.username})
    response.set_cookie(
        COOKIE_NAME,
        token,
        httponly=True,
        max_age=60 * 60 * 24 * 30,
        samesite="lax",
        secure=settings.cookie_secure,
    )
    return AuthState(authenticated=True, username=payload.username)


def logout(response: Response) -> AuthState:
    response.delete_cookie(COOKIE_NAME)
    return AuthState(authenticated=False)
