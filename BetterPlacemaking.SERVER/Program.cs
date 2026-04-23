using BetterPlacemaking.Controllers;
using BetterPlacemaking.Services;
using BetterPlacemaking.Authorization;
using FirebaseAdmin;
using Google.Apis.Auth.OAuth2;
using Google.Cloud.Firestore;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.Extensions.Caching.Distributed;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi.Models;
using System.Text;


var builder = WebApplication.CreateBuilder(args);

if (builder.Environment.IsDevelopment())
{
    DotEnv.LoadIfPresent(builder.Environment.ContentRootPath);
    builder.Configuration.AddEnvironmentVariables();
}
// CONFIG
var config = builder.Configuration;

var credsPath = config["Google:CredentialsFile"];

if (!string.IsNullOrEmpty(credsPath))
    Environment.SetEnvironmentVariable("GOOGLE_APPLICATION_CREDENTIALS", credsPath);

var firebaseSection = builder.Configuration.GetSection("Firebase");
var projectId = firebaseSection["ProjectId"] ?? throw new InvalidOperationException("Firebase:ProjectId missing");
var dbId = firebaseSection["Database"] ?? "(default)";

// SERVICES
builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();
builder.Services.AddScoped<SampleService>();
builder.Services.AddScoped<UserService>();
builder.Services.AddScoped<AuthSessionService>();
builder.Services.AddScoped<RefreshTokenService>();
builder.Services.AddSingleton<EmailService>();
builder.Services.AddScoped<PasswordService>();
builder.Services.AddScoped<NotificationService>();
builder.Services.AddScoped<HomographyService>();
builder.Services.AddScoped<IntrinsicsService>();
builder.Services.AddScoped<DeviceService>();
builder.Services.AddHttpContextAccessor();
builder.Services.AddSingleton<TokenService>();
builder.Services.AddScoped<AdminService>();
builder.Services.Configure<CloudStorageService.GcsOptions>(builder.Configuration.GetSection("Gcs"));
builder.Services.AddSingleton<CloudStorageService>();
builder.Services.AddScoped<MediaService>();
builder.Services.AddScoped<ProjectService>();
builder.Services.AddScoped<BoardLibraryService>();
builder.Services.AddScoped<FloorplanLibraryService>();
builder.Services.AddScoped<LidarService>();
builder.Services.AddScoped<ScanService>();
builder.Services.AddScoped<ScanScheduleService>();


//Fusion services

builder.Services.AddScoped<FusionRunner>();
builder.Services.AddScoped<FusionService>();
builder.Services.AddHostedService<FusionSchedulerService>();
builder.Services.AddSingleton<FusionCancellationRegistry>();

// Visualizer services (point cloud, mesh generation, export)
builder.Services.AddSingleton<BetterPlacemaking.Services.Visualizer.PointCloudService>();
builder.Services.AddSingleton<BetterPlacemaking.Services.Visualizer.GeometryCalculationService>();
builder.Services.AddSingleton<BetterPlacemaking.Services.Visualizer.ObjParserService>();
builder.Services.AddSingleton<BetterPlacemaking.Services.Visualizer.XyzParserService>();
builder.Services.AddSingleton<BetterPlacemaking.Services.Visualizer.MeshGenerationService>();
builder.Services.AddSingleton<BetterPlacemaking.Services.Visualizer.FastMeshService>();
builder.Services.AddSingleton<BetterPlacemaking.Services.Visualizer.GeometryExportService>();
builder.Services.AddSingleton<BetterPlacemaking.Services.Visualizer.PlyParserService>();

// RPLidar solid-objects / floor-map (ported from P2BP-25_26-Visualizer)
builder.Services.AddSingleton<CoordinateTransformService>();
builder.Services.AddSingleton<TrackingDataService>(sp =>
{
    var cfg = sp.GetRequiredService<IConfiguration>();
    var log = sp.GetService<ILogger<TrackingDataService>>();
    var transform = sp.GetRequiredService<CoordinateTransformService>();
    return new TrackingDataService(cfg, log, transform);
});
builder.Services.AddSingleton<BetterPlacemaking.Services.Rplidar.RplidarScanService>();

builder.Services.Configure<ScanIngestOptions>(builder.Configuration.GetSection(ScanIngestOptions.SectionName));
builder.Services.PostConfigure<ScanIngestOptions>(o =>
{
    var set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    foreach (var h in o.AllowedHosts ?? [])
    {
        if (!string.IsNullOrWhiteSpace(h))
            set.Add(h.Trim());
    }

    // GCS signed URLs (path/virtual-hosted) and Firebase Storage download URLs the Pi may store in ObjUrl.
    foreach (var d in new[]
             {
                 "storage.googleapis.com",
                 "firebasestorage.googleapis.com",
                 "storage.cloud.google.com",
             })
        set.Add(d);
    o.AllowedHosts = set.ToArray();
});
builder.Services.AddHttpClient(ScanCompleteVisualizerIngestService.HttpClientName, client =>
{
    client.Timeout = TimeSpan.FromMinutes(10);
});
builder.Services.AddSingleton<ScanCompleteVisualizerIngestService>();

// Caching
// Cloud Run can scale to multiple instances, so use Redis when configured.
// Falls back to in-memory IDistributedCache for local dev when Redis isn't set.
var redisConfiguration = config.GetConnectionString("Redis") ?? config["Redis:Configuration"];
if (!string.IsNullOrWhiteSpace(redisConfiguration))
{
    builder.Services.AddStackExchangeRedisCache(options =>
    {
        options.Configuration = redisConfiguration;
        options.InstanceName = config["Redis:InstanceName"] ?? "BetterPlacemaking:";
    });
}
else
{
    builder.Services.AddDistributedMemoryCache();
}

const string UserJwtScheme = "UserJwt";
const string DeviceApiKeyScheme = "DeviceApiKey";

const string UserJwtPolicy = "UserJwt";
const string DeviceApiKeyPolicy = "DeviceApiKey";

var jwtKey = config["Jwt:Key"];
var jwtIssuer = config["Jwt:Issuer"];
var jwtAudience = config["Jwt:Audience"];

if (string.IsNullOrWhiteSpace(jwtKey))
    throw new InvalidOperationException(
        "Jwt:Key is missing. This must be provided as a secret (e.g., environment variable Jwt__Key in Cloud Run / Secret Manager)."
    );

if (string.IsNullOrWhiteSpace(jwtIssuer) || string.IsNullOrWhiteSpace(jwtAudience))
    throw new InvalidOperationException(
        "Jwt:Issuer and/or Jwt:Audience is missing. Configure them in appsettings.json/appsettings.Production.json or via environment variables (Jwt__Issuer, Jwt__Audience)."
    );

var signingKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey));

builder.Services.AddAuthentication(options =>
    {
        options.DefaultAuthenticateScheme = UserJwtScheme;
        options.DefaultChallengeScheme = UserJwtScheme;
    })
    .AddJwtBearer(UserJwtScheme, options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = signingKey,
            ValidateIssuer = true,
            ValidIssuer = jwtIssuer,
            ValidateAudience = true,
            ValidAudience = jwtAudience,
            ValidateLifetime = true,
            ClockSkew = TimeSpan.FromMinutes(2)
        };
    })
    .AddScheme<AuthenticationSchemeOptions, DeviceApiKeyAuthenticationHandler>(
        DeviceApiKeyScheme,
        options => { });

builder.Services.AddSingleton<IAuthorizationPolicyProvider, PermissionAuthorizationPolicyProvider>();
builder.Services.AddScoped<IAuthorizationHandler, PermissionAuthorizationHandler>();
builder.Services.AddSingleton<FirestoreAuthorizationDataService>();
builder.Services.AddSingleton<AuthorizationRoleSeeder>();

builder.Services.AddAuthorization(options =>
{
    var userJwtDefaultPolicy = new AuthorizationPolicyBuilder()
        .RequireAuthenticatedUser()
        .AddAuthenticationSchemes(UserJwtScheme)
        .Build();

    options.DefaultPolicy = userJwtDefaultPolicy;
    options.AddPolicy(UserJwtPolicy, userJwtDefaultPolicy);

    options.AddPolicy(DeviceApiKeyPolicy, policy =>
    {
        policy.RequireAuthenticatedUser();
        policy.AddAuthenticationSchemes(DeviceApiKeyScheme);
    });
});

// builder.Services.AddSingleton(provider =>
// {
//     // Uses GOOGLE_APPLICATION_CREDENTIALS or ambient credentials
//     return FirebaseApp.Create(new AppOptions
//     {
//         Credential = GoogleCredential.GetApplicationDefault(),
//         ProjectId = projectId
//     });
// });

builder.Services.AddControllers().AddJsonOptions(opts =>
{
  opts.JsonSerializerOptions.PropertyNamingPolicy = null;
  // Pi / JS / Python clients often send camelCase; sponsors may send PascalCase — accept both.
  opts.JsonSerializerOptions.PropertyNameCaseInsensitive = true;
});

builder.Services.AddSingleton<FirestoreDb>(_ =>
    new FirestoreDbBuilder
    {
        ProjectId = projectId,
        DatabaseId = dbId
    }.Build());

builder.Services.AddSwaggerGen(options =>
{
    options.SwaggerDoc("v1", new OpenApiInfo
    {
        Title = "Better Placemaking API",
        Version = "v1"
    });

    options.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme
    {
        Description = "JWT Authorization header using the Bearer scheme. Example: Bearer {token}",
        Name = "Authorization",
        In = ParameterLocation.Header,
        Type = SecuritySchemeType.Http,
        Scheme = "bearer",
        BearerFormat = "JWT"
    });

    options.AddSecurityDefinition(DeviceApiKeyScheme, new OpenApiSecurityScheme
    {
        Description = "Device API key in the form: Bearer {api_key}",
        Name = "Authorization",
        In = ParameterLocation.Header,
        Type = SecuritySchemeType.ApiKey
    });

    options.AddSecurityRequirement(new OpenApiSecurityRequirement
    {
        {
            new OpenApiSecurityScheme
            {
                Reference = new OpenApiReference
                {
                    Type = ReferenceType.SecurityScheme,
                    Id = "Bearer"
                }
            },
            Array.Empty<string>()
        },
        {
            new OpenApiSecurityScheme
            {
                Reference = new OpenApiReference
                {
                    Type = ReferenceType.SecurityScheme,
                    Id = DeviceApiKeyScheme
                }
            },
            Array.Empty<string>()
        }
    });
});

// CORS

var allowedOrigins = config["AllowedOrigins"];
if (!string.IsNullOrEmpty(allowedOrigins))
{
    builder.Services.AddCors(options =>
    {
        options.AddPolicy("_myAllowSpecificOrigins", policy =>
        {
            policy.WithOrigins(allowedOrigins.Split(',').Select(o => o.Trim()).Where(o => !string.IsNullOrEmpty(o)).ToArray())
                  .AllowAnyHeader()
                  .AllowAnyMethod()
                  .AllowCredentials();
        });
    });
}

// Build

var app = builder.Build();

var startupLogger = app.Services.GetRequiredService<ILoggerFactory>().CreateLogger("Startup");
startupLogger.LogInformation("Firestore target configured: ProjectId={ProjectId}, DatabaseId={DatabaseId}", projectId, dbId);

using (var seedScope = app.Services.CreateScope())
{
    var roleSeeder = seedScope.ServiceProvider.GetRequiredService<AuthorizationRoleSeeder>();
    await roleSeeder.SeedAsync();
}

// Middleware

// Needed for Cloud Run / reverse proxies so scheme/remote IP are correct.
var forwardedHeadersOptions = new ForwardedHeadersOptions
{
    ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto
};
forwardedHeadersOptions.KnownNetworks.Clear();
forwardedHeadersOptions.KnownProxies.Clear();
app.UseForwardedHeaders(forwardedHeadersOptions);

if (app.Environment.IsDevelopment())
{
    app.UseSwagger(options =>
    {
        options.OpenApiVersion = Microsoft.OpenApi.OpenApiSpecVersion.OpenApi3_0;
    });
    app.UseSwaggerUI(options =>
    {
        options.SwaggerEndpoint("/swagger/v1/swagger.json", "Better Placemaking API V1");
        options.RoutePrefix = "swagger";
    });
}

app.UseHttpsRedirection();

app.UseStaticFiles();
app.UseRouting();

if (!string.IsNullOrEmpty(allowedOrigins))
    app.UseCors("_myAllowSpecificOrigins");

app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();

await app.RunAsync();
