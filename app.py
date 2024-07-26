import dash
from dash import Dash, html, dcc
import dash_bootstrap_components as dbc

app = Dash(
    __name__,
    use_pages=True,
    meta_tags=[{"name": "viewport", "content": "width=device-width, initial-scale=1"}],
)

app.title = "AI Visuals"
server = app.server
app.config.suppress_callback_exceptions = True
app.scripts.config.serve_locally = True

# Define the logo image and link to home page
logo = html.A(
    # Change the src attribute to the path of your logo image
    html.Img(src="/assets/logo.png", id="navbar-logo"),
    href="/",
    id="navbar-logo-link",
)

nav_links = [
    dbc.NavItem(dbc.NavLink(f"{page['name'] }", href=page["relative_path"]))
    for page in dash.page_registry.values()
]

app.layout = html.Div(
    [
        dash.page_container,
    ]
)

if __name__ == "__main__":
    app.run(debug=True,
            port="8888",
            dev_tools_hot_reload=False)
