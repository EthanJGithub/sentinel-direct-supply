# NOTE: build context is the REPO ROOT (see docker-compose.yml `context: .` /
# DEPLOY.md) so this Dockerfile can bake the catalog seed into the image. A
# standalone `docker build` from this directory will NOT find ../../data —
# see DEPLOY.md for the exact build command.

# ---- build ----
FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build
WORKDIR /src
COPY services/catalog-csharp/Catalog.csproj .
RUN dotnet restore
COPY services/catalog-csharp/. .
RUN dotnet publish -c Release -o /app

# ---- runtime ----
FROM mcr.microsoft.com/dotnet/aspnet:9.0 AS runtime
WORKDIR /app
COPY --from=build /app .
# data baked into the image (repo-root build context); docker-compose's volume
# mount overrides this path for local dev so edits show up without a rebuild.
COPY data /data
ENV ASPNETCORE_URLS=http://+:8080
ENV SEED_DIR=/data/catalog
EXPOSE 8080
ENTRYPOINT ["dotnet", "Catalog.dll"]
