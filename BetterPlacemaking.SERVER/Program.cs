using BetterPlacemaking.Controllers;
using BetterPlacemaking.Services;
using BetterPlacemaking.Authorization;
using FirebaseAdmin;
using Google.Apis.Auth.OAuth2;
using Google.Cloud.Firestore;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Authentication;
using Microsoft.OpenApi.Models;

var builder = WebApplication.CreateBuilder(args);

// CONFIG
var env = builder.Environment;
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
builder.Services.AddScoped<LoginService>();
builder.Services.AddSingleton<EmailService>();
builder.Services.AddScoped<PasswordService>();
builder.Services.AddScoped<DeviceService>();
builder.Services.AddHttpContextAccessor();

builder.Services.AddAuthentication("DeviceApiKey")
    .AddScheme<AuthenticationSchemeOptions, DeviceApiKeyAuthenticationHandler>(
        "DeviceApiKey",
        options => { });

builder.Services.AddScoped<IAuthorizationHandler, DeviceApiKeyHandler>();
builder.Services.AddAuthorization(options =>
{
    options.AddPolicy("DeviceApiKey", policy =>
    {
        policy.Requirements.Add(new DeviceApiKeyRequirement());
        policy.AddAuthenticationSchemes("DeviceApiKey");
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

    options.AddSecurityDefinition("DeviceApiKey", new OpenApiSecurityScheme
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
                    Id = "DeviceApiKey"
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
            policy.WithOrigins(allowedOrigins.Split(','))
                  .AllowAnyHeader()
                  .AllowAnyMethod();
        });
    });
}

// Build

var app = builder.Build();

// Middleware

if (app.Environment.IsDevelopment())
{
    app.MapControllers();
    app.UseSwagger(options =>
    {
        options.OpenApiVersion = Microsoft.OpenApi.OpenApiSpecVersion.OpenApi3_0;
    });
    app.UseSwaggerUI(options =>
    {
        options.SwaggerEndpoint("/swagger/v1/swagger.json", "Better Placemaking API V1");
        options.RoutePrefix = "swagger";
    });
    app.UseHttpsRedirection();
}

app.UseStaticFiles();
app.UseRouting();
app.UseCors("_myAllowSpecificOrigins");
app.UseAuthentication();
app.UseAuthorization();
app.MapControllerRoute(
    name: "default",
    pattern: "{controller=Home}/{action=Index}/{id?}"
);

app.Run();