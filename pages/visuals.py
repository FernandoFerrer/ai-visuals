import dash
from dash import html, dcc, callback, Input, Output, State, ALL
from dash.exceptions import PreventUpdate
import dash_bootstrap_components as dbc
import dash_daq as daq
import plotly.express as px
import plotly.graph_objects as go
import numpy as np
from PIL import Image

from utils.llm_utils import generate_text_story
from utils.image_gen_utils import generate_image

dash.register_page(__name__)

layout = html.Div(
    [
        html.Div([

            html.Div([

                # Left Column
                html.Div([

                    # Input text
                    html.Div([
                        dcc.Textarea(id='input-text-seed',
                                     value="""An alien was walking down the street. \
                                           Suddenly, a bright light, followed by a strong sound coming from the sky.""",)
                    ], className='row'),

                    # Output text story
                    html.Div([
                        html.Div(id='output-text-story')
                    ], className='row'),

                    # Img style
                    html.Div([
                        dcc.Dropdown(id='img-style-dropdown', options=['Vincent Van Gogh painting',
                                                                       'Pablo Picasso painting',
                                                                       'Futuristic',
                                                                       'Cartoonish',
                                                                       'Cyberpunk',
                                                                       'Psychedelic'],
                                                                       value='Futuristic')
                    ], className='row'),

                    # Button to generate
                    html.Div([
                        daq.ToggleSwitch(
                            id='generate-switch',
                            value=False
                        ),
                    ], className='row'),

                ], className='col-3'),

                # Output visual
                html.Div([
                    # html.Img(id='output-visual',
                    #          src=None)
                    html.Div(id='output-visual')
                ], className='col-9'),
                
            ], className='row'),

        ], className="container-fluid apply-padding", id='main-content'),

        # Storage components:
        dcc.Store(id='store-text-story', data=''),

    ]
)

# Callbacks --------------------------------------------------
    
# Callback for text story
@callback(
    Output('output-text-story', 'children'),
    State('output-text-story', 'children'),
    State('input-text-seed', 'value'),
    Input('generate-switch', 'value'),
)

def generate_image_(text_story,
                    text_seed,
                    generate_switch):
    
    if not generate_switch:
        raise PreventUpdate
    else:
        if text_story is None:
            text_gen_prompt = text_seed
        else:
            text_gen_prompt = text_story

        output_text_story = generate_text_story(text_gen_prompt)

        return output_text_story
    
# Callback for image generation
@callback(
    Output('output-visual', 'style'),
    Output('main-content', 'style'),
    Input('output-text-story', 'children'),
    Input('generate-switch', 'value'),
    Input('img-style-dropdown', 'value'),
)

def generate_image_(text_story,
                    generate_switch,
                    img_style):
    
    if not generate_switch:
        raise PreventUpdate
    else:
        if text_story is not None:

            img_path, img_relative_path = generate_image(text_story,
                                                         img_style)

            # Read the image and calculate average color:
            img = Image.open(img_path)
            img = img.resize((256, 256))
            img = np.array(img)

            avg_color = np.mean(img, axis=(0, 1))
            avg_color = 'rgb' + str(tuple(avg_color))

            median_color = np.median(img, axis=(0, 1))
            median_color = 'rgb' + str(tuple(median_color))

            min_color = np.min(img, axis=(0, 1))
            min_color = 'rgb' + str(tuple(min_color))

            max_color = np.max(img, axis=(0, 1))
            max_color = 'rgb' + str(tuple(max_color))

            img_gradient = f"linear-gradient(90deg, {min_color} 0%, {avg_color} 38%)"

            # Image styling:
            img_style = {'background-image': f'url({img_relative_path})',
                        'background-size': "100% 100%",
                        'background-position': 'center',
                        'background-repeat': 'no-repeat',
                        'height': '90vh',
                        'width': '100%',
                        'border-radius': '10px',
                        'box-shadow': f'inset 0px 0px 24px 24px {avg_color}'}
            
            # Background styling:
            bg_style = {'background': img_gradient,
                        'animation': 'gradient 15s ease infinite'}


            return img_style, bg_style


