"""Authentication: Cognito JWT (Bearer) or API key. Dev-only bypass via AUTH_DISABLED."""

from __future__ import annotations

import os
from typing import Annotated, Optional

import jwt
from fastapi import Depends, HTTPException, Security
from fastapi.security import APIKeyHeader, HTTPAuthorizationCredentials, HTTPBearer

security = HTTPBearer(auto_error=False)
api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


def _auth_disabled() -> bool:
    return os.environ.get("AUTH_DISABLED", "").lower() in ("1", "true", "yes")


def _decode_cognito_jwt(token: str) -> str:
    region = os.environ.get("COGNITO_REGION", "")
    pool = os.environ.get("COGNITO_USER_POOL_ID", "")
    app_client_id = os.environ.get("COGNITO_APP_CLIENT_ID", "")
    if not region or not pool:
        raise HTTPException(
            status_code=500,
            detail="COGNITO_REGION and COGNITO_USER_POOL_ID must be set when auth is enabled",
        )
    issuer = f"https://cognito-idp.{region}.amazonaws.com/{pool}"
    jwks_url = f"{issuer}/.well-known/jwks.json"
    jwk_client = jwt.PyJWKClient(jwks_url)
    signing_key = jwk_client.get_signing_key_from_jwt(token)
    payload = jwt.decode(
        token,
        signing_key.key,
        algorithms=["RS256"],
        issuer=issuer,
        options={"verify_aud": False},
    )
    if payload.get("token_use") not in ("id", "access"):
        raise HTTPException(status_code=401, detail="Invalid token type")
    if app_client_id:
        token_use = payload.get("token_use")
        if token_use == "id" and payload.get("aud") != app_client_id:
            raise HTTPException(status_code=401, detail="Invalid token audience")
        if token_use == "access" and payload.get("client_id") != app_client_id:
            raise HTTPException(status_code=401, detail="Invalid token client_id")
    sub = payload.get("sub")
    if not sub:
        raise HTTPException(status_code=401, detail="Missing sub claim")
    return str(sub)


async def current_user_sub(
    creds: Optional[HTTPAuthorizationCredentials] = Security(security),
    api_key: Optional[str] = Security(api_key_header),
) -> str:
    if _auth_disabled():
        return os.environ.get("DEV_USER_SUB", "dev-local")

    keys = [k.strip() for k in os.environ.get("API_KEYS", "").split(",") if k.strip()]
    if api_key and keys and api_key in keys:
        return os.environ.get("API_KEY_USER_SUB", "api-key-user")

    if not creds:
        raise HTTPException(status_code=401, detail="Not authenticated")

    return _decode_cognito_jwt(creds.credentials)


CurrentUser = Annotated[str, Depends(current_user_sub)]
