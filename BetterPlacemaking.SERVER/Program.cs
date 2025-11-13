using BetterPlacemaking.Controllers;
using BetterPlacemaking.Services;
using FirebaseAdmin;
using Google.Apis.Auth.OAuth2;
using Google.Cloud.Firestore;

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

// builder.Services.AddSingleton(provider =>
// {
//     // Uses GOOGLE_APPLICATION_CREDENTIALS or ambient credentials
//     return FirebaseApp.Create(new AppOptions
//     {
//         Credential = GoogleCredential.GetApplicationDefault(),
//         ProjectId = projectId
//     });
// });

builder.Services.AddSingleton<FirestoreDb>(_ =>
    new FirestoreDbBuilder
    {
        ProjectId = projectId,
        DatabaseId = dbId
    }.Build());

builder.Services.AddSwaggerGen(options =>
{
    options.SwaggerDoc("v1", new Microsoft.OpenApi.Models.OpenApiInfo
    {
        Title = "Better Placemaking API",
        Version = "v1"
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
    app.MapControllers().AllowAnonymous();
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
app.UseCors("_myAllowSpecificOrigins");
app.MapControllerRoute(
    name: "default",
    pattern: "{controller=Home}/{action=Index}/{id?}"
);

app.Run();