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
builder.Services.AddScoped<DeviceService>();
builder.Services.AddHttpContextAccessor();
builder.Services.AddSingleton<TokenService>();
builder.Services.AddScoped<AdminService>();

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

builder.Services.AddAuthorization(options =>
{
    options.AddPolicy(UserJwtPolicy, policy =>
    {
        policy.RequireAuthenticatedUser();
        policy.AddAuthenticationSchemes(UserJwtScheme);
    });

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

// Middleware

// Needed for Cloud Run / reverse proxies so scheme/remote IP are correct.
app.UseForwardedHeaders(new ForwardedHeadersOptions
{
    ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto
});

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